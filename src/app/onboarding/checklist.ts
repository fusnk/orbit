/**
 * Home's "Getting started" card, after a first-run setup: add an addon,
 * play something, set up profiles. Each item ticks itself off from what the
 * profile actually has; the card goes for good once all three are done or
 * it's dismissed. It starts hidden, so it never flashes in for anyone else.
 */
import * as registry from '../../addons/registry';
import type { RoomContext } from '../router';
import { icon } from '../../components/icons';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { listProfiles } from '../../library/profiles';
import { onWatchChange, watchHistory } from '../../library/watch';
import { openProfileSwitcher } from '../../rooms/profiles/picker';
import { HOME_SHOWN } from '../../rooms/home/dashboard';
import { dismissKeepingFocus } from '../../rooms/home/keep-place';
import { openSettingsTo } from '../../rooms/settings';
import { reportError } from '../errors';
import './onboarding.css';
import { usableAddons } from '../../catalog/service';
import { checklistItems, checklistVisible, playLeadsTo, type ChecklistItemId, type ChecklistState } from './rules';
import { loadChecklist, ONBOARDING_CLOSED, saveChecklist } from './state';

const LABELS: Record<ChecklistItemId, MessageKey> = {
  addon: 'onboard.checklist.addon',
  play: 'onboard.checklist.play',
  profiles: 'onboard.checklist.profiles',
};

/** Whether the card was ever started (then Home's older "install an addon" notice stays away). */
export async function checklistStarted(): Promise<boolean> {
  return !!(await loadChecklist().catch(() => null));
}

/** `onClosed`: the card was dismissed, or went once everything on it was done. */
export function createChecklistCard(ctx: RoomContext, onClosed?: () => void): HTMLElement {
  const list = h('ul', { class: 'checklist-items' });
  const count = h('span', { class: 'muted' });
  const dismiss = h('button', { class: 'welcome-dismiss', title: t('onboard.checklist.dismiss'), 'aria-label': t('onboard.checklist.dismiss') }, icon('close'));
  const card = h(
    'section',
    { class: 'welcome checklist', 'aria-labelledby': 'checklist-title', hidden: true },
    h('div', { class: 'welcome-text' }, h('span', { class: 'welcome-title', id: 'checklist-title' }, t('onboard.checklist.title')), count),
    list,
    h('div', { class: 'welcome-actions' }, dismiss),
  );
  let state: ChecklistState | null = null;
  /** Addons in use that find streams, as last counted. */
  let streamAddons = 0;

  const save = (next: ChecklistState) => {
    state = next;
    saveChecklist(next).catch((err: unknown) => reportError('Could not save the Getting started card', err, 'warn'));
  };

  const openAddons = () => {
    openSettingsTo('addons');
    ctx.go('settings');
  };
  const ACTIONS: Record<ChecklistItemId, () => void> = {
    addon: openAddons,
    play: () => (playLeadsTo(streamAddons) === 'movies' ? ctx.go('movies') : openAddons()),
    profiles: () => {
      if (state) save({ ...state, profilesSeen: true });
      void openProfileSwitcher(true).catch((err: unknown) => reportError('Could not open the profile switcher', err));
      void refresh();
    },
  };

  async function refresh(): Promise<void> {
    state = await loadChecklist().catch(() => null);
    if (!state || state.dismissed) return void (card.hidden = true);
    const [addons, profiles, usable] = await Promise.all([registry.list().catch(() => []), listProfiles().catch(() => []), usableAddons().catch(() => [])]);
    streamAddons = usable.filter((addon) => addon.manifest.resources.some((r) => r.name === 'stream')).length;
    const items = checklistItems(state, { ownAddons: addons.filter((a) => !a.builtIn).length, history: watchHistory().titles.length, profiles: profiles.length });
    if (!checklistVisible(state, items)) {
      // All done: the card has served its purpose and stays gone.
      save({ ...state, dismissed: true });
      card.hidden = true;
      onClosed?.();
      return;
    }
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.item : undefined;
    count.textContent = t('onboard.checklist.progress', { done: items.filter((i) => i.done).length, total: items.length });
    list.replaceChildren(
      ...items.map((item) => {
        const button = h(
          'button',
          { class: 'checklist-item', 'data-item': item.id, 'aria-label': item.done ? t('onboard.checklist.label-done', { item: t(LABELS[item.id]) }) : t(LABELS[item.id]), disabled: item.done },
          h('span', { class: 'checklist-tick', 'aria-hidden': 'true' }, item.done ? icon('check') : ''),
          t(LABELS[item.id]),
        );
        button.addEventListener('click', ACTIONS[item.id]);
        return h('li', {}, button);
      }),
    );
    card.hidden = false;
    if (focused) list.querySelector<HTMLElement>(`[data-item="${focused}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }

  dismiss.addEventListener('click', () => {
    dismissKeepingFocus(card, () => (card.hidden = true));
    if (state) save({ ...state, dismissed: true });
    onClosed?.();
  });

  const update = () => void refresh().catch((err: unknown) => reportError('Could not check the Getting started card', err, 'warn'));
  update();
  // Something played, setup just finished, Home shown again (e.g. back from installing an addon).
  onWatchChange(() => (card.isConnected ? update() : undefined));
  document.addEventListener(HOME_SHOWN, update);
  document.addEventListener(ONBOARDING_CLOSED, update);
  return card;
}
