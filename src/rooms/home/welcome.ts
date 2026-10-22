import { t } from '../../i18n';
import * as registry from '../../addons/registry';
import { isUsable } from '../../addons/routing';
import type { RoomContext } from '../../app/router';
import { icon } from '../../components/icons';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { openSettingsTo } from '../settings';
import { dismissKeepingFocus } from './keep-place';
import { checklistStarted } from '../../app/onboarding/checklist';
import { ONBOARDING_CLOSED } from '../../app/onboarding/state';

const DISMISSED_KEY = 'home.welcome-dismissed';

async function shouldShow(): Promise<boolean> {
  if ((await settings.get(DISMISSED_KEY)) === true) return false;
  // After first-run setup, Home's Getting started card covers adding an addon.
  if (await checklistStarted()) return false;
  const addons = await registry.list();
  return !addons.some((addon) => isUsable(addon) && addon.manifest.resources.some((r) => r.name === 'stream'));
}

/**
 * A slim notice under the hero, shown while no stream addon is enabled.
 * It starts hidden and only appears once the check passes, so returning users
 * never see it flash. Dismissing it is remembered.
 */
export function createWelcomeCard(ctx: RoomContext): HTMLElement {
  const install = h('button', { class: 'button primary' }, t('browse.welcome.install'));
  install.addEventListener('click', () => {
    openSettingsTo('addons');
    ctx.go('settings');
  });
  const dismiss = h('button', { class: 'welcome-dismiss', title: t('browse.welcome.dismiss'), 'aria-label': t('browse.welcome.dismiss') }, icon('close'));

  const card = h(
    'section',
    { class: 'welcome', 'aria-labelledby': 'welcome-title', hidden: true },
    h('span', { class: 'welcome-mark', 'aria-hidden': 'true' }, icon('play', { filled: true })),
    h(
      'div',
      { class: 'welcome-text' },
      h('span', { class: 'welcome-title', id: 'welcome-title' }, t('browse.welcome.title')),
      h('span', { class: 'muted' }, t('browse.welcome.detail')),
    ),
    h('div', { class: 'welcome-actions' }, install, dismiss),
  );

  dismiss.addEventListener('click', () => {
    dismissKeepingFocus(card, () => (card.hidden = true));
    settings.set(DISMISSED_KEY, true).catch((err: unknown) => console.error('Could not save dismissal', err));
  });

  const check = () =>
    shouldShow()
      .then((show) => {
        card.hidden = !show;
      })
      .catch((err: unknown) => console.error('Could not check addons for the welcome card', err));
  void check();
  // First-run setup ending starts the Getting started card, which takes this one's place.
  document.addEventListener(ONBOARDING_CLOSED, () => void check());
  // Installing or enabling a stream addon (or removing the last one) is what it's about.
  registry.onAddonsChange(() => void check());
  return card;
}
