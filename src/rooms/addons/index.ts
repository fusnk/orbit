import { describeAddonError, toAddonError } from '../../addons/errors';
import { addonHealth, onHealthChange } from '../../addons/health';
import * as registry from '../../addons/registry';
import type { InstalledAddon } from '../../addons/types';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { activeProfileId, listProfiles } from '../../library/profiles';
import { createImportPage, createSharePage } from './bundle';
import { createDetails } from './details';
import { openAddonConfigure } from '../../lib/browser';
import { SHOW_TAB } from '../settings/categories';
import { choices } from '../settings/playback';
import { ADDON_LINK, createInstallPanel } from './install';
import { actionButton, addonLogo, badgeList } from './parts';
import { errorState, errorText } from '../../components/state-message';
import { reducedMotion } from '../../theme/appearance';

/** A tab Settings adds beside Installed (Source preferences). */
export interface ExtraTab {
  id: string;
  label: string;
  render(): HTMLElement;
}

/**
 * Settings → Addons & Sources, and the Addons page (`page`): install by URL,
 * then enable, reorder, inspect or remove; and `extra`'s tab. An ADDON_LINK
 * event on the panel (the manifest URL) loads it for review. A SHOW_TAB event
 * on the panel (`installed` or the extra tab's id) switches tabs.
 */
export function createAddonsPanel(extra?: ExtraTab, page = false): HTMLElement {
  let addons: InstalledAddon[] = [];
  /** Shared addons this profile took off its list, which it can put back. */
  let removed: InstalledAddon[] = [];
  /** Sharing only matters with someone to share with. */
  let otherProfiles = false;
  /** The name of the profile whose addons this one uses; then the list is read-only. */
  let linkedTo: string | null = null;
  const status = h('p', { class: 'status', role: 'status' });
  const linkedNote = h('p', { class: 'addons-linked muted', hidden: true });
  const list = h('ul', { class: 'addon-list', 'aria-label': t('integrations.addons.installed-list') });
  const shareAll = actionButton(t('integrations.addons.share-all'), () => {
    const shared = shareAll.dataset.share === 'true';
    void run(() => registry.setAllShared(shared), 'share-all', shared ? t('integrations.addons.all-shared') : t('integrations.addons.all-private'));
  }, { 'data-focus-id': 'share-all', hidden: true });
  // Fetches every addon's manifest again; the result goes in the status line.
  const checkUpdates = actionButton(t('integrations.addons.check-updates'), () => {
    checkUpdates.disabled = true;
    setStatus(t('integrations.addons.checking-updates'));
    void registry
      .refreshManifests()
      .then(({ updated, failed }) => {
        const parts = [updated ? tn('integrations.addons.updates-found', updated) : '', failed ? tn('integrations.addons.updates-failed', failed) : ''].filter(Boolean);
        setStatus(parts.length ? parts.join(' · ') : t('integrations.addons.up-to-date'), !updated && failed > 0);
        return refresh('check-updates');
      })
      .catch((err: unknown) => setStatus(describeAddonError(toAddonError(err)), true))
      .finally(() => {
        checkUpdates.disabled = false;
      });
  }, { 'data-focus-id': 'check-updates' });
  const shareBundle = actionButton(t('integrations.bundle.share'), () => openPage(createSharePage(backToList('share-bundle'))), { 'data-focus-id': 'share-bundle' });
  const importBundle = actionButton(t('integrations.bundle.import'), () => openPage(createImportPage({
    installedIds: () => new Set(addons.flatMap((a) => (a.manifest ? [a.manifest.id] : []))),
    onInstalled: () => refresh(),
    setUp: (name, configureUrl) => {
      backToList()();
      setUp(name, configureUrl);
    },
    onBack: backToList('import-bundle'),
  })), { 'data-focus-id': 'import-bundle' });
  /** "N installed · M enabled", beside the Installed heading. */
  const count = h('span', { class: 'segment-count addons-count' });
  /** Each row's "Didn't answer" mark, updated in place when an addon starts or stops answering. */
  const healthMarks = new Map<string, HTMLElement>();
  let stopHealth: (() => void) | null = null;
  const removedList = h('ul', { class: 'addon-list', 'aria-label': t('integrations.addons.removed-heading') });
  const removedSection = h('section', { hidden: true }, h('h2', {}, t('integrations.addons.removed-heading')), h('p', { class: 'muted' }, t('integrations.addons.removed-intro')), removedList);

  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.classList.toggle('error', isError);
  };

  const install = createInstallPanel(async (addon) => {
    const updated = addons.some((a) => a.key === addon.key);
    const name = addon.manifest?.name ?? addon.displayHost;
    const done = updated ? t('integrations.addons.updated', { name }) : t('integrations.addons.installed-done', { name });
    setStatus(done);
    await refresh();
  }, (name, url) => setUp(name, url));
  // On the Addons page, a heading and a line saying what the field takes.
  const installArea = page
    ? h('section', { class: 'addons-install', 'aria-labelledby': 'addons-add-heading' }, h('h2', { id: 'addons-add-heading' }, t('addonspage.add-heading')), h('p', { class: 'muted addons-install-hint' }, t('addonspage.install-hint')), h('p', { class: 'muted addons-install-hint' }, t('addonspage.where-from')), install.element)
    : install.element;

  const main = h('div', {}, linkedNote, status, h('div', { class: 'addons-heading' }, h('h2', {}, t('integrations.addons.installed'), count), h('div', { class: 'addons-heading-actions' }, checkUpdates, shareAll, shareBundle, importBundle)), list, removedSection);
  // The extra tab is built the first time it's opened.
  let extraView: HTMLElement | undefined;
  let onExtra = false;
  const tabList: (readonly [string, string])[] = [['installed', t('integrations.addons.installed')], ...(extra ? [[extra.id, extra.label] as const] : [])];
  // A single tab (the Addons page) needs no tab row.
  const tabbed = tabList.length > 1;
  const view = h('div', tabbed ? { role: 'tabpanel' } : {});
  const tabIds = tabList.map(([id]) => id);
  const firstTab = tabIds[0]!;
  const showTab = (tab: string) => {
    // Installing by URL belongs with the addons, not with source preferences.
    onExtra = tab === extra?.id;
    installArea.hidden = !!linkedTo || onExtra;
    if (extra && tab === extra.id) {
      extraView ??= h('div', { 'data-tab': extra.id }, extra.render());
      view.replaceChildren(extraView);
    } else {
      view.replaceChildren(main);
      void refresh();
    }
  };
  const tabs = choices(t('integrations.addons.tabs'), tabList, firstTab, showTab, 'tabs');
  // One view holds whichever tab is chosen; the chosen tab names it.
  const tabId = (tab: string) => `addons-tab-${page ? 'page' : 'settings'}-${tab}`;
  [...tabs.children].forEach((segment, i) => (segment.id = tabId(tabIds[i]!)));
  const labelView = () => view.setAttribute('aria-labelledby', tabs.querySelector('[aria-selected="true"]')?.id ?? tabId(firstTab));
  if (tabbed) {
    tabs.addEventListener('click', labelView);
    labelView();
  }
  const top = tabbed ? [h('div', { class: 'addons-tabs' }, tabs)] : [];
  const room = h('div', { class: page ? 'addons-panel addons-page-panel' : 'addons-panel' }, ...top, installArea, view);
  view.append(main);

  /** Opens an addon's configure page in the browser and waits for the link it gives. */
  function setUp(name: string, configureUrl: string): void {
    void openAddonConfigure(configureUrl).catch((err: unknown) => setStatus(errorText(err), true));
    install.expectLink(name);
    installArea.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /** Shows a page (sharing or adding a bundle) in place of the panel. */
  function openPage(content: HTMLElement): void {
    room.replaceChildren(content);
    content.querySelector('button')?.focus();
  }

  /** Puts the panel back from such a page, focusing `focusId` when given. */
  function backToList(focusId?: string): () => void {
    return () => {
      room.replaceChildren(...top, installArea, view);
      if (focusId) restoreFocus(focusId);
    };
  }

  /** Why the list couldn't be read, when there's none to show: said in its place, with Try again, rather than "No addons installed". */
  let listError: unknown = null;

  async function refresh(focusId?: string): Promise<void> {
    listError = null;
    try {
      const [installed, profiles, activeId] = await Promise.all([registry.list(), listProfiles(), activeProfileId()]);
      addons = installed;
      otherProfiles = profiles.length > 1;
      const me = profiles.find((p) => p.id === activeId);
      linkedTo = profiles.find((p) => p.id === me?.addonsFrom)?.name ?? null;
      removed = linkedTo ? [] : await registry.removedList();
    } catch (err) {
      if (addons.length) setStatus(describeAddonError(toAddonError(err)), true);
      else listError = err;
    }
    renderList();
    // Live while the list shows; the subscription ends the first time it fires with the panel gone, and starts again here.
    stopHealth ??= onHealthChange(() => {
      if (room.isConnected) return drawHealth();
      stopHealth?.();
      stopHealth = null;
    });
    if (focusId) restoreFocus(focusId);
  }

  /** Marks the addons whose latest request went unanswered this session. */
  function drawHealth(): void {
    for (const [key, mark] of healthMarks) {
      const health = addonHealth(key);
      mark.hidden = !health || health.answered;
      const why = health?.error ? describeAddonError(health.error) : '';
      mark.title = why;
      mark.setAttribute('aria-label', why ? `${t('addons.health.no-answer')}: ${why}` : t('addons.health.no-answer'));
    }
  }

  /**
   * Re-rendering replaces the buttons, so focus is moved to the equivalent new one.
   * A stand-in is never a toggle (Enabled, Share): one more Enter would flip it.
   */
  function restoreFocus(focusId: string): void {
    const [key] = focusId.split(':');
    const exact = main.querySelector<HTMLButtonElement>(`[data-focus-id="${focusId}"]`);
    const target =
      (exact && !exact.disabled && !exact.hidden ? exact : null) ??
      main.querySelector<HTMLButtonElement>(`[data-focus-id^="${key}:"]:not(:disabled):not([aria-pressed])`) ??
      list.querySelector<HTMLButtonElement>('button:not(:disabled):not([aria-pressed])') ??
      checkUpdates;
    target?.focus();
  }

  /** `failedFocusId`: where focus goes if the action fails, when that differs from `focusId` (a remove that didn't happen). */
  async function run(action: () => Promise<unknown>, focusId: string, success?: string, failedFocusId = focusId): Promise<void> {
    let ok = true;
    try {
      await action();
      setStatus(success ?? '');
    } catch (err) {
      ok = false;
      setStatus(describeAddonError(toAddonError(err)), true);
    }
    await refresh(ok ? focusId : failedFocusId);
  }

  function showDetails(addon: InstalledAddon): void {
    if (!addon.manifest) return;
    const details = createDetails({ ...addon, manifest: addon.manifest }, () => {
      // Back to the tabs and the list (not the list alone, which left the tabs off the panel).
      backToList(`${addon.key}:details`)();
    });
    room.replaceChildren(details);
    details.querySelector('button')?.focus();
  }

  /**
   * Where focus goes once the addon at `index` is removed: the next addon's Remove (or, from
   * the last, the previous one's), which takes two presses; Details on a built-in, which has none.
   */
  function afterRemove(index: number): string {
    const neighbour = addons[index + 1] ?? addons[index - 1];
    if (!neighbour) return 'check-updates';
    return `${neighbour.key}:${neighbour.builtIn ? 'details' : 'remove'}`;
  }

  function row(addon: InstalledAddon, index: number): HTMLElement {
    const { manifest, key } = addon;
    const name = manifest?.name ?? addon.displayHost;
    const focusId = (action: string) => `${key}:${action}`;

    const toggle = actionButton(t('integrations.addons.enabled'), () => void run(() => registry.setEnabled(key, !addon.enabled), focusId('toggle')), {
      'data-focus-id': focusId('toggle'),
      'aria-pressed': String(addon.enabled),
      disabled: !manifest || !addon.urlReadable,
    });
    const up = actionButton(t('integrations.addons.move-up'), () => void run(() => registry.move(key, index - 1), focusId('up')), {
      'data-focus-id': focusId('up'),
      disabled: index === 0,
    });
    const down = actionButton(t('integrations.addons.move-down'), () => void run(() => registry.move(key, index + 1), focusId('down')), {
      'data-focus-id': focusId('down'),
      disabled: index === addons.length - 1,
    });
    const details = actionButton(t('integrations.addons.details'), () => showDetails(addon), {
      'data-focus-id': focusId('details'),
      disabled: !manifest,
    });
    // Fetches this addon's manifest again (Check for updates does every one).
    const refreshOne = actionButton(t('addons.health.refresh'), () => {
      refreshOne.disabled = true;
      setStatus(t('addons.health.refreshing', { name }));
      void registry
        .refreshManifests(key)
        .then(({ updated, failed }) => setStatus(failed ? t('addons.health.refresh-failed', { name }) : updated ? t('addons.health.refreshed', { name }) : t('addons.health.unchanged', { name }), failed > 0))
        .catch((err: unknown) => setStatus(describeAddonError(toAddonError(err)), true))
        .finally(() => void refresh(focusId('refresh')));
    }, { 'data-focus-id': focusId('refresh'), disabled: !addon.urlReadable });
    // Someone else's shared addon only leaves this profile's list.
    const removeLabel = addon.owned ? t('integrations.common.remove') : t('integrations.addons.remove-from-list');
    const removed = addon.owned
      ? t('integrations.addons.removed', { name })
      : addon.sharedBy
        ? t('integrations.addons.removed-shared', { name, owner: addon.sharedBy })
        : t('integrations.addons.removed-shared-unknown', { name });
    // Two-step remove: the first press arms it, leaving the button disarms it.
    const remove = actionButton(removeLabel, () => {
      if (remove.dataset.armed) void run(() => registry.remove(key), afterRemove(index), removed, focusId('remove'));
      else {
        remove.dataset.armed = 'true';
        remove.textContent = addon.owned && addon.shared ? t('integrations.addons.remove-everyone') : t('integrations.addons.confirm-remove');
      }
    }, { class: 'button danger', 'data-focus-id': focusId('remove') });
    remove.addEventListener('blur', () => {
      delete remove.dataset.armed;
      remove.textContent = removeLabel;
    });
    const share = actionButton(addon.shared ? t('integrations.addons.shared') : t('integrations.addons.share'), () => void run(() => registry.setShared(key, !addon.shared), focusId('share'), addon.shared ? t('integrations.addons.now-private', { name }) : t('integrations.addons.now-shared', { name })), {
      'data-focus-id': focusId('share'),
      'aria-pressed': String(addon.shared),
      title: t('integrations.addons.share-title'),
    });

    // A linked profile can look but not change anything.
    const actions = linkedTo
      ? [details, refreshOne]
      : // Built-in addons (Cinemeta) can be disabled but not removed.
        [toggle, up, down, details, refreshOne, addon.owned && otherProfiles ? share : '', addon.builtIn ? '' : remove];
    return h('li', { class: addon.enabled ? 'addon-row' : 'addon-row off' }, ...addonSummary(addon), h('div', { class: 'addon-actions' }, ...actions));
  }

  /** A removed addon isn't asked anything, so its row has no health mark. */
  function addonSummary(addon: InstalledAddon, withHealth = true): HTMLElement[] {
    const { manifest } = addon;
    const name = manifest?.name ?? addon.displayHost;
    let health: HTMLElement | '' = '';
    if (withHealth) {
      health = h('span', { class: 'addon-health', role: 'img', hidden: true }, h('span', { class: 'addon-health-dot', 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }, t('addons.health.no-answer')));
      healthMarks.set(addon.key, health);
    }
    return [
      addonLogo(name, manifest?.logo),
      h(
        'div',
        { class: 'addon-info' },
        h('div', {}, h('strong', { dir: 'auto' }, name), manifest ? h('span', { class: 'muted' }, ` v${manifest.version}`) : '', health),
        manifest?.description ? h('p', { class: 'addon-description', dir: 'auto' }, manifest.description) : '',
        h('p', { class: 'muted' }, [addon.displayHost, ...(manifest?.types ?? [])].join(' · ')),
        badgeList(manifest, addon),
      ),
    ];
  }

  function removedRow(addon: InstalledAddon): HTMLElement {
    const name = addon.manifest?.name ?? addon.displayHost;
    const restore = actionButton(t('integrations.addons.restore'), () => void run(() => registry.restore(addon.key), `${addon.key}:restore`, t('integrations.addons.restored', { name })), {
      'data-focus-id': `${addon.key}:restore`,
    });
    return h('li', { class: 'addon-row off' }, ...addonSummary(addon, false), h('div', { class: 'addon-actions' }, restore));
  }

  function renderList(): void {
    linkedNote.hidden = !linkedTo;
    linkedNote.textContent = linkedTo ? t('integrations.addons.linked', { owner: linkedTo }) : '';
    installArea.hidden = !!linkedTo || onExtra;
    const own = addons.filter((a) => a.owned && !a.builtIn);
    const allShared = own.every((a) => a.shared);
    shareAll.hidden = !!linkedTo || !otherProfiles || own.length < 2;
    shareAll.textContent = allShared ? t('integrations.addons.stop-sharing-all') : t('integrations.addons.share-all');
    shareAll.dataset.share = String(!allShared);
    // Built-ins aren't shared (everyone has them); a linked profile can't add addons.
    shareBundle.hidden = !addons.some((a) => !a.builtIn);
    importBundle.hidden = !!linkedTo;
    count.textContent = addons.length ? ` ${t('addons.health.count', { installed: tn('addons.health.installed', addons.length), enabled: tn('addons.health.enabled', addons.filter((a) => a.enabled).length) })}` : '';
    healthMarks.clear();
    list.replaceChildren(
      ...(addons.length
        ? addons.map(row)
        : listError !== null
          ? [h('li', {}, errorState({ title: t('states.addons.failed'), err: listError, retry: () => void refresh() }))]
          : [h('li', { class: 'muted' }, t('integrations.addons.empty'))]),
    );
    removedSection.hidden = !removed.length;
    removedList.replaceChildren(...removed.map(removedRow));
    drawHealth();
  }

  void refresh();
  room.addEventListener(SHOW_TAB, (event) => {
    const index = tabIds.indexOf((event as CustomEvent<string>).detail);
    const segment = tabs.children[index];
    if (!(segment instanceof HTMLElement) || segment.getAttribute('aria-selected') === 'true') return;
    // From a sharing or import page, back to the tabs first.
    if (!view.isConnected) backToList()();
    segment.click();
  });
  // An install link from a website (app/deep-link.ts): its review, as for a pasted URL.
  room.addEventListener(ADDON_LINK, (event) => {
    if (!view.isConnected) backToList()();
    install.load((event as CustomEvent<string>).detail, true);
    installArea.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  return room;
}
