/**
 * "Reset this section", at the foot of a Settings category: asks first,
 * listing exactly which rows go back to their defaults (only those that
 * differ), then resets them and redraws the page. What it may touch is
 * decided in defaults.ts: never accounts, secrets, addons, sources, folders,
 * profiles, the library or history.
 */
import { onBack } from '../../app/back';
import { pushLayer } from '../../components/layers';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { resetPrefs, resettable, type Pref } from './defaults';

/** The footer: a quiet button and what it leaves alone. `redraw` rebuilds the page after a reset. */
export function resetFooter(category: string, sectionName: string, redraw: () => void): HTMLElement {
  const button = h('button', { class: 'button', 'aria-haspopup': 'dialog' }, t('settings.reset.button'));
  // A flag rather than `disabled` while it looks: disabling the focused button would drop focus to the page.
  let busy = false;
  button.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void resettable(category)
      .then((prefs) => {
        if (!prefs.length) return toast(t('settings.reset.nothing'));
        confirmReset(sectionName, prefs, button, async () => {
          const failed = await resetPrefs(prefs);
          toast(failed ? t('settings.reset.failed') : t('settings.reset.done', { section: sectionName }));
          redraw();
        });
      })
      .finally(() => (busy = false));
  });
  return h('div', { class: 'settings-reset' }, h('p', { class: 'setting-hint' }, t('settings.reset.hint')), button);
}

/** The confirmation: the rows that will change, Cancel (focused) and Reset. Escape, Back or the scrim cancel. */
function confirmReset(sectionName: string, prefs: readonly Pref[], returnTo: HTMLElement, reset: () => Promise<void>): void {
  const cancel = h('button', { class: 'button' }, t('settings.common.cancel'));
  const confirm = h('button', { class: 'button danger' }, t('settings.reset.confirm'));
  const card = h(
    'div',
    { class: 'settings-reset-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-reset-title', 'aria-describedby': 'settings-reset-intro' },
    h('h2', { class: 'settings-reset-title', id: 'settings-reset-title' }, t('settings.reset.title', { section: sectionName })),
    h('p', { class: 'setting-hint', id: 'settings-reset-intro' }, t('settings.reset.intro')),
    h('ul', { class: 'settings-reset-list' }, ...prefs.map((pref) => h('li', {}, t(pref.label)))),
    h('p', { class: 'setting-hint' }, t('settings.reset.keeps')),
    h('div', { class: 'settings-reset-actions' }, cancel, confirm),
  );
  const scrim = h('div', { class: 'scrim' });
  const layer = h('div', { class: 'settings-reset-layer' }, card);

  let done = false;
  function close(): void {
    if (done) return;
    done = true;
    removeBack();
    removeLayer();
    layer.remove();
    scrim.remove();
    // After a reset the page is drawn again: focus goes to its new button.
    (returnTo.isConnected ? returnTo : document.querySelector<HTMLElement>('.settings-pane .settings-reset button'))?.focus({ preventScroll: true });
  }
  const removeBack = onBack(close);
  scrim.addEventListener('click', close);
  layer.addEventListener('click', (event) => {
    if (event.target === layer) close();
  });
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    confirm.disabled = cancel.disabled = true;
    void reset().finally(close);
  });
  document.body.append(scrim, layer);
  const removeLayer = pushLayer(layer, close);
  requestAnimationFrame(() => scrim.classList.add('open'));
  cancel.focus({ preventScroll: true });
}
