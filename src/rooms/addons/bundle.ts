/**
 * Settings → Addons → Share your addons / Add addons from a bundle.
 *
 * Sharing: Rust builds the bundle (configured addons go in as "needs setup",
 * never with their link); the page only counts it and saves or copies it.
 * Adding: a bundle is untrusted, so each install entry goes through the normal
 * install path (Rust fetches the manifest under its rules, the schema checks
 * it, the review shows it) and nothing is installed until the person picks
 * addons and confirms.
 */
import { BundleError, MAX_BUNDLE_CHARS, bundleManifest, bundleText, parseBundle, saveBundle, type Bundle, type BundleEntry } from '../../addons/bundle';
import { describeAddonError, describeManifestError, toAddonError } from '../../addons/errors';
import * as registry from '../../addons/registry';
import { reviewManifest, sourceOf } from '../../addons/review';
import type { Manifest } from '../../addons/types';
import { createTextField } from '../../components/text-field';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { ADULT_CONFIRMED } from './install';
import { actionButton, addonLogo, badgeList } from './parts';
import { renderReview } from './review';
import { errorText } from '../../components/state-message';

/** Manifests fetched at once while checking a bundle. */
const PARALLEL_CHECKS = 4;

function page(title: string, intro: string, onBack: () => void, ...content: HTMLElement[]): HTMLElement {
  return h(
    'div',
    { class: 'addon-details addon-bundle' },
    actionButton(t('integrations.addons.back'), onBack, { class: 'button back' }),
    h('h1', {}, title),
    h('p', { class: 'muted' }, intro),
    ...content,
  );
}

export function createSharePage(onBack: () => void): HTMLElement {
  const summary = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, t('integrations.bundle.checking')));
  const status = h('div', { class: 'status', role: 'status' });
  const actions = h('div', { class: 'actions', hidden: true });

  const save = actionButton(t('integrations.bundle.save'), () => {
    void saveBundle()
      .then((path) => path && status.replaceChildren(t('integrations.bundle.saved-to', { path })))
      .catch((err: unknown) => status.replaceChildren(describeAddonError(toAddonError(err))));
  }, { class: 'button primary' });
  const copy = actionButton(t('integrations.bundle.copy'), () => {
    void bundleText()
      .then(async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          status.replaceChildren(t('integrations.bundle.copied'));
        } catch {
          // Where the clipboard isn't allowed, the text is shown to copy by hand.
          const area = h('textarea', { class: 'diagnostics-text', readonly: true, rows: '10', 'aria-label': t('integrations.bundle.text-label') });
          area.value = text;
          status.replaceChildren(t('integrations.bundle.copy-failed'), area);
        }
      })
      .catch((err: unknown) => status.replaceChildren(describeAddonError(toAddonError(err))));
  });
  actions.append(save, copy);

  void bundleText()
    .then((text) => {
      let bundle: Bundle;
      try {
        bundle = parseBundle(text);
      } catch {
        summary.replaceChildren(h('p', {}, t('integrations.bundle.share-empty')));
        return;
      }
      const setup = bundle.entries.filter((e) => e.kind === 'setup').length;
      summary.replaceChildren(
        h('p', {}, tn('integrations.bundle.share-summary', bundle.entries.length)),
        setup ? h('p', { class: 'muted' }, tn('integrations.bundle.share-setup', setup)) : '',
      );
      actions.hidden = false;
    })
    .catch((err: unknown) => summary.replaceChildren(h('p', { class: 'status error' }, describeAddonError(toAddonError(err)))));

  return page(t('integrations.bundle.share'), t('integrations.bundle.share-intro'), onBack, summary, actions, status);
}

interface ImportOptions {
  /** Manifest ids already installed, which aren't offered again. */
  installedIds: () => Set<string>;
  onInstalled: () => Promise<void>;
  /** Opens a "needs setup" addon's configure page and asks for the link it gives. */
  setUp: (name: string, configureUrl: string) => void;
  onBack: () => void;
}

interface Row {
  element: HTMLElement;
  /** Set once it can be installed: the URL and the manifest the review showed. */
  ready?: { url: string; manifest: Manifest } | undefined;
  picked: boolean;
}

export function createImportPage(options: ImportOptions): HTMLElement {
  const message = h('p', { class: 'status', role: 'status' });
  const results = h('div', { class: 'bundle-results' });
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  let rows: Row[] = [];
  let adultOk = false;
  /** Unlocks the adult addons waiting for the age confirmation. */
  const adultLocked: (() => void)[] = [];

  const field = createTextField({ label: t('integrations.bundle.paste'), placeholder: '{ "orbitAddons": 1, … }', onSubmit: (value) => read(value) });
  const readButton = actionButton(t('integrations.bundle.read'), () => read(field.value), { class: 'button primary' });
  const choose = actionButton(t('integrations.bundle.choose-file'), () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Checked before reading, so a huge file is never loaded.
    if (file.size > MAX_BUNDLE_CHARS * 4) showError(new BundleError('too-large'));
    else void file.text().then(read, () => showError(new BundleError('not-a-bundle')));
  });

  const installButton = actionButton('', () => void installPicked(), { class: 'button primary' });
  const updateInstallButton = () => {
    const count = rows.filter((r) => r.picked && r.ready).length;
    installButton.textContent = count ? tn('integrations.bundle.install-selected', count) : t('integrations.bundle.install-none');
    installButton.disabled = count === 0;
  };

  function showError(err: BundleError): void {
    results.replaceChildren();
    message.classList.add('error');
    message.textContent = t(`integrations.bundle.${err.reason}`);
  }

  function read(text: string): void {
    if (!text.trim()) return;
    let bundle: Bundle;
    try {
      bundle = parseBundle(text.trim());
    } catch (err) {
      showError(err instanceof BundleError ? err : new BundleError('not-a-bundle'));
      return;
    }
    message.classList.remove('error');
    message.textContent = bundle.skipped ? tn('integrations.bundle.skipped', bundle.skipped) : '';
    void showBundle(bundle);
  }

  async function showBundle(bundle: Bundle): Promise<void> {
    adultOk = (await settings.get(ADULT_CONFIRMED).catch(() => null)) === true;
    const installed = options.installedIds();
    adultLocked.length = 0;
    rows = bundle.entries.map(() => ({ element: h('li', { class: 'addon-row' }), picked: false }));
    results.replaceChildren(
      h('p', { class: 'muted' }, t('integrations.bundle.network')),
      h('ul', { class: 'addon-list', 'aria-label': t('integrations.bundle.import') }, ...rows.map((r) => r.element)),
      h('div', { class: 'actions' }, installButton),
    );
    updateInstallButton();
    // The entries are checked a few at a time; each row fills in when its manifest arrives.
    const queue = bundle.entries.map((entry, i) => [entry, rows[i]!] as const);
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await fill(next[1], next[0], installed);
    };
    await Promise.all(Array.from({ length: PARALLEL_CHECKS }, worker));
  }

  function heading(name: string, version: string | undefined, host: string | null, manifest?: Manifest): HTMLElement {
    return h(
      'div',
      { class: 'addon-info' },
      h('div', {}, h('strong', {}, name), version ? h('span', { class: 'muted' }, ` v${version}`) : ''),
      host ? h('p', { class: 'muted' }, host) : '',
      manifest ? badgeList(manifest) : '',
    );
  }

  function setupRow(row: Row, name: string, version: string | undefined, host: string | null): void {
    const configureUrl = host ? `https://${host}/configure` : null;
    row.element.replaceChildren(
      addonLogo(name, undefined),
      heading(name, version, host),
      h(
        'div',
        { class: 'addon-actions' },
        h('span', { class: 'badge' }, t('integrations.addons.needs-setup')),
        configureUrl ? actionButton(t('integrations.addons.set-up'), () => options.setUp(name, configureUrl)) : '',
      ),
    );
    row.element.querySelector('.addon-info')?.append(h('p', { class: 'muted' }, configureUrl ? t('integrations.bundle.needs-setup') : t('integrations.bundle.needs-setup-local')));
  }

  async function fill(row: Row, entry: BundleEntry, installed: Set<string>): Promise<void> {
    if (entry.kind === 'setup') {
      setupRow(row, entry.name, entry.version, entry.host);
      return;
    }
    const host = sourceOf(entry.url)?.host ?? null;
    row.element.replaceChildren(addonLogo(entry.name, undefined), heading(entry.name, entry.version, host), h('p', { class: 'muted' }, t('integrations.bundle.checking')));
    let manifest: Manifest | null;
    try {
      manifest = await bundleManifest(entry.url);
    } catch (err) {
      row.element.replaceChildren(
        addonLogo(entry.name, undefined),
        heading(entry.name, entry.version, host),
        h('p', { class: 'status error' }, t('integrations.bundle.failed', { error: describeManifestError(toAddonError(err)) })),
      );
      return;
    }
    // It leads to this machine or the home network, which a bundle from someone else may not make Orbit contact.
    if (!manifest) {
      row.element.replaceChildren(addonLogo(entry.name, undefined), heading(entry.name, entry.version, host), h('p', { class: 'status error' }, t('prfixes.bundle.local')));
      return;
    }
    // The address asks for settings now: the person sets it up like any configured addon.
    if (manifest.behaviorHints.configurationRequired) {
      setupRow(row, manifest.name, manifest.version, host);
      return;
    }
    const review = reviewManifest(manifest, sourceOf(entry.url));
    const info = heading(manifest.name, manifest.version, host, manifest);
    if (manifest.id !== entry.id) info.append(h('p', { class: 'addon-review-note warn' }, t('integrations.bundle.different', { name: manifest.name })));
    info.append(renderReview(review, { compact: true }));
    const actions = h('div', { class: 'addon-actions' });
    row.element.replaceChildren(addonLogo(manifest.name, manifest.logo), info, actions);

    if (installed.has(manifest.id)) {
      actions.append(h('span', { class: 'badge' }, t('integrations.bundle.already')));
      return;
    }
    row.ready = { url: entry.url, manifest };
    const pick = actionButton(t('integrations.bundle.pick'), () => {
      row.picked = !row.picked;
      pick.setAttribute('aria-pressed', String(row.picked));
      updateInstallButton();
    }, { 'aria-pressed': 'false' });
    actions.append(pick);
    // Adult addons ask for the same confirmation as installing one by its address.
    if (manifest.behaviorHints.adult && !adultOk) {
      pick.disabled = true;
      const note = h('p', { class: 'addon-review-note warn' }, t('integrations.addons.adult-warning'));
      const confirm = actionButton(t('integrations.addons.adult-confirm'), () => {
        void settings
          .set(ADULT_CONFIRMED, true)
          .then(() => {
            adultOk = true;
            for (const unlock of adultLocked.splice(0)) unlock();
            pick.focus();
          })
          .catch((err: unknown) => (message.textContent = t('integrations.addons.save-failed', { error: errorText(err) })));
      });
      adultLocked.push(() => {
        pick.disabled = false;
        note.remove();
        confirm.remove();
      });
      actions.append(confirm);
      info.append(note);
    }
  }

  async function installPicked(): Promise<void> {
    const picked = rows.filter((r) => r.picked && r.ready);
    installButton.disabled = true;
    installButton.textContent = t('integrations.bundle.installing');
    let done = 0;
    const failures: string[] = [];
    // One at a time, in the bundle's order, so they land on the list in that order; announced once, at the end.
    await registry.inOneChange(async () => {
      for (const row of picked) {
        const { url, manifest } = row.ready!;
        try {
          await registry.install(url, manifest);
          done++;
          row.ready = undefined;
          row.picked = false;
          const actions = row.element.querySelector('.addon-actions');
          actions?.replaceChildren(h('span', { class: 'badge' }, t('integrations.bundle.already')));
        } catch (err) {
          failures.push(t('integrations.bundle.install-failed', { name: manifest.name, error: describeAddonError(toAddonError(err)) }));
        }
      }
    });
    message.classList.toggle('error', failures.length > 0);
    message.textContent = [done ? tn('integrations.bundle.installed', done) : '', ...failures].filter(Boolean).join(' ');
    updateInstallButton();
    if (done) await options.onInstalled();
  }

  return page(
    t('integrations.bundle.import'),
    t('integrations.bundle.import-intro'),
    options.onBack,
    h('div', { class: 'install-row' }, field, readButton, choose),
    input,
    message,
    results,
  );
}
