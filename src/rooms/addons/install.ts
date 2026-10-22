import { describeAddonError, describeManifestError, toAddonError } from '../../addons/errors';
import * as registry from '../../addons/registry';
import { reviewManifest, sourceOf } from '../../addons/review';
import type { InstalledAddon, Manifest } from '../../addons/types';
import { beginEditing, createTextField } from '../../components/text-field';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { actionButton, addonLogo, badgeList } from './parts';
import { renderReview } from './review';
import { errorText } from '../../components/state-message';

/** Set once the person has said they're 18 or older (asked before the first adult addon). */
export const ADULT_CONFIRMED = 'addons.adult-confirmed';

/** Dispatched on the addons panel with a manifest URL from an install link (app/deep-link.ts), to review it. */
export const ADDON_LINK = 'orbit:addon-link';

/** Where a `configurationRequired` addon's own configure page lives. */
const configureUrl = (url: string) => url.replace(/^stremio:\/\//i, 'https://').replace(/manifest\.json$/, 'configure');

/**
 * URL field → manifest preview → install. Nothing is stored until the user
 * confirms. An install link hands URLs in with `load`, and after opening an
 * addon's configure page (an imported bundle's Set up) the panel asks for its
 * link with `expectLink`.
 */
export function createInstallPanel(onInstalled: (addon: InstalledAddon) => Promise<void>, setUp?: (name: string, configureUrl: string) => void): { element: HTMLElement; load(url: string, fromLink?: boolean): void; expectLink(name: string): void } {
  const message = h('p', { class: 'status', role: 'status' });
  const preview = h('div', { class: 'install-preview', hidden: true });
  /** Counts loads: a newer one supersedes any still in flight, whose result is then ignored. */
  let run = 0;

  const setMessage = (text: string, isError = false) => {
    message.textContent = text;
    message.classList.toggle('error', isError);
  };

  const field = createTextField({
    label: t('integrations.addons.url'),
    placeholder: 'https://…/manifest.json',
    onSubmit: (value) => void load(value),
  });
  // Said as an address field by screen readers; typing is unchanged (nothing is validated by the browser).
  field.type = 'url';
  const loadButton = actionButton(t('integrations.addons.load'), () => void load(field.value), { class: 'button primary' });

  const closePreview = () => {
    preview.hidden = true;
    preview.replaceChildren();
  };

  /**
   * `fromLink`: it came from a website's install link, which the review says. Until the person
   * `confirmed` it, such a link is fetched only from the internet (see `registry.fetchLinkedManifest`).
   */
  async function load(url: string, fromLink = false, confirmed = false): Promise<void> {
    const current = ++run;
    closePreview();
    if (!url.trim()) return setMessage('');
    setMessage(t('integrations.addons.loading-manifest'));
    try {
      const manifest = fromLink && !confirmed ? await registry.fetchLinkedManifest(url) : await registry.fetchManifest(url);
      if (current !== run) return;
      setMessage('');
      if (!manifest) return showHomeNetwork(url.trim());
      await showPreview(url.trim(), manifest, current, fromLink);
    } catch (err) {
      if (current === run) setMessage(describeManifestError(toAddonError(err)), true);
    }
  }

  /**
   * An install link to this machine or the home network: nothing has been contacted yet. Its
   * address (the host only: the rest can hold keys) comes first, and Continue fetches the review.
   */
  function showHomeNetwork(url: string): void {
    const cancel = actionButton(t('integrations.common.cancel'), () => {
      closePreview();
      field.focus();
    });
    const proceed = actionButton(t('deeplink.continue'), () => void load(url, true, true), { class: 'button primary' });
    preview.replaceChildren(
      h('div', { class: 'addon-heading' }, h('div', {}, h('strong', {}, sourceOf(url)?.host ?? ''), h('div', { class: 'badges' }, h('span', { class: 'badge warn' }, t('deeplink.home-network'))))),
      h('p', {}, t('deeplink.home-network-note')),
      h('p', { class: 'muted' }, t('deeplink.from-website')),
      h('div', { class: 'actions' }, proceed, cancel),
    );
    preview.hidden = false;
    proceed.focus();
  }

  async function showPreview(url: string, manifest: Manifest, current = run, fromLink = false): Promise<void> {
    const hints = manifest.behaviorHints;
    const cancel = actionButton(t('integrations.common.cancel'), () => {
      closePreview();
      field.focus();
    });
    const notes: HTMLElement[] = fromLink ? [h('p', { class: 'muted' }, t('deeplink.from-website'))] : [];
    const actions = h('div', { class: 'actions' });

    if (hints.configurationRequired) {
      notes.push(
        h('p', {}, t('integrations.addons.configure-first')),
        h('code', { class: 'selectable' }, configureUrl(url)),
      );
      // Opens it in the person's browser (Rust allows public https pages only) and waits for the link, as a bundle's Set up does.
      if (setUp) actions.append(actionButton(t('integrations.addons.set-up'), () => setUp(manifest.name, configureUrl(url)), { class: 'button primary' }));
      actions.append(cancel);
    } else if (hints.adult && (await settings.get(ADULT_CONFIRMED)) !== true) {
      notes.push(h('p', {}, t('integrations.addons.adult-warning')));
      const confirm = actionButton(t('integrations.addons.adult-confirm'), () => {
        settings
          .set(ADULT_CONFIRMED, true)
          .then(() => showPreview(url, manifest, current, fromLink))
          .catch((err: unknown) => setMessage(t('integrations.addons.save-failed', { error: errorText(err) }), true));
      });
      actions.append(confirm, cancel);
    } else {
      // Set up again (a new URL for an addon already here): its settings are updated in place, not added as a second copy.
      const updating = registry.reconfigures(await registry.list().catch(() => []), manifest, url);
      if (updating) notes.push(h('p', {}, h('strong', {}, t('prfixes.addons.update-question')), ' ', t('prfixes.addons.update-detail', { name: updating.manifest?.name ?? manifest.name })));
      const install = actionButton(updating ? t('prfixes.addons.update') : t('integrations.addons.install'), () => {
        install.disabled = true;
        registry
          .install(url, manifest, updating?.key)
          .then(async (addon) => {
            closePreview();
            field.value = '';
            field.focus();
            await onInstalled(addon);
          })
          .catch((err: unknown) => {
            setMessage(describeAddonError(toAddonError(err)), true);
            install.disabled = false;
          });
      }, { class: 'button primary' });
      actions.append(install, cancel);
    }

    // A newer load came in while the adult setting was read.
    if (current !== run) return;
    // Only the host of what was typed is shown: the rest of an install link can hold keys.
    preview.replaceChildren(
      h(
        'div',
        { class: 'addon-heading' },
        addonLogo(manifest.name, manifest.logo),
        h('div', {}, h('strong', {}, manifest.name), h('span', { class: 'muted' }, ` v${manifest.version}`), badgeList(manifest)),
      ),
      manifest.description ? h('p', {}, manifest.description) : '',
      renderReview(reviewManifest(manifest, sourceOf(url))),
      ...notes,
      actions,
    );
    preview.hidden = false;
    actions.querySelector('button')?.focus();
  }

  return {
    element: h('div', { class: 'install' }, h('div', { class: 'install-row' }, field, loadButton), message, preview),
    load: (url, fromLink) => {
      field.value = url;
      void load(url, fromLink);
    },
    expectLink: (name) => {
      closePreview();
      field.value = '';
      setMessage(t('integrations.addons.expect-link', { name }));
      beginEditing(field);
    },
  };
}
