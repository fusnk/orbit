/**
 * The title bar's bell: how many new episodes wait, and a panel listing them
 * (poster, show, episode, air date, Play). The panel is a modal layer like a
 * menu: the app behind is inert, arrow keys (spatial nav) and Tab stay inside, and
 * Back, Esc, a click outside or playing closes it. Show and episode names
 * came from addons, so they're text nodes only.
 */
import './alerts-bell.css';
import type { RoomContext } from './router';
import { onBack } from './back';
import { shownNow } from '../catalog/parental';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { artImage } from '../components/cards';
import { icon } from '../components/icons';
import { pushLayer } from '../components/layers';
import { placeMenu } from '../components/menu';
import { isRtl, locale, t, tn } from '../i18n';
import { airedDateText, alertItems, alertPrefs, markAllRead, markRead, onAlertsChange, type AlertItem } from '../library/alerts';
import { libraryEntries } from '../library/library';
import { episodeName, hiddenFor } from '../library/spoilers';
import { recentlyWatched } from '../library/watch';
import { h } from '../lib/dom';
import { pageLeft } from '../rooms/detail/page-left';
import { playTitle } from '../rooms/detail/streams';
import { createDetail } from '../rooms/detail';

/** `ctx` is read when needed: the router is built after the title bar. */
export function createAlertsBell(ctx: () => RoomContext): HTMLElement {
  const badge = h('span', { class: 'alerts-badge', hidden: true });
  const button = h('button', { class: 'round-button alerts-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon('bell'), badge);
  button.addEventListener('click', () => openPanel(button, ctx()));

  const sync = () => {
    const unread = shownAlerts(sync).filter((item) => !item.read).length;
    const shown = alertPrefs().enabled;
    button.hidden = !shown;
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    const label = unread > 0 ? tn('alerts.bell.unread', unread) : t('alerts.bell.label');
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  onAlertsChange(sync);
  sync();
  return button;
}

/**
 * The alerts this profile may watch now (its content limit): a show over it is
 * left out of the panel and the count, not deleted. `redraw` runs once shows
 * still being rated are known.
 */
const shownAlerts = (redraw: () => void): AlertItem[] => shownNow(alertItems(), (item) => ({ id: item.titleId, type: 'series' }), redraw);

/** The saved snapshot of an announced show, for Play and its page; the full title is looked up first. */
function snapshotOf(item: AlertItem): Title {
  const known = [...libraryEntries().map((e) => e.title), ...recentlyWatched()].find((title) => title.id === item.titleId);
  return known ?? { id: item.titleId, type: 'series', name: item.show, ...(item.poster ? { poster: item.poster } : {}), genres: [], origins: [] };
}

function openPanel(anchor: HTMLElement, ctx: RoomContext): void {
  const returnFocus = document.activeElement;
  const list = h('div', { class: 'alerts-list', role: 'list' });
  const markAll = h('button', { class: 'alerts-mark-read' }, t('alerts.panel.mark-read'));
  markAll.addEventListener('click', () => {
    markAllRead();
    // The button hides once nothing is unread: focus moves into the list rather than being lost.
    (list.querySelector<HTMLElement>('.alerts-play') ?? panel).focus({ preventScroll: true });
  });
  const panel = h(
    'div',
    { class: 'alerts-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('alerts.panel.heading'), tabindex: '-1' },
    h('div', { class: 'alerts-head' }, h('h2', { class: 'alerts-heading' }, t('alerts.panel.heading')), markAll),
    list,
  );

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    removeBack();
    removeLayer();
    stopListening();
    document.removeEventListener('pointerdown', onOutside, true);
    panel.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  const removeBack = onBack(close);
  const onOutside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node)) close();
  };
  document.addEventListener('pointerdown', onOutside, true);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  const withTitle = (item: AlertItem, then: (title: Title) => void) => {
    const snapshot = snapshotOf(item);
    // The episode list can take a while: if the person has moved on meanwhile, nothing opens over where they are now.
    const left = pageLeft();
    void loadMeta('series', item.titleId)
      .catch(() => null)
      .then((full) => left() || then(full ?? snapshot));
  };
  const render = () => {
    const items = shownAlerts(render);
    markAll.hidden = !items.some((item) => !item.read);
    if (items.length === 0) {
      list.replaceChildren(h('p', { class: 'alerts-empty' }, t('alerts.panel.empty')));
      return;
    }
    list.replaceChildren(
      ...items.map((item) => {
        const show = h('button', { class: 'alerts-show' }, item.show);
        show.addEventListener('click', () => {
          markRead(item.videoId);
          close();
          withTitle(item, (title) => ctx.open(createDetail(title, ctx)));
        });
        const play = h('button', { class: 'alerts-play', 'aria-label': t('alerts.panel.play-label', { show: item.show, season: item.season, episode: item.episode }) }, icon('play', { filled: true }), t('alerts.panel.play'));
        play.addEventListener('click', () => {
          markRead(item.videoId);
          close();
          // The episode list is loaded first so Play has the episode as the addon describes it (id, title, thumbnail).
          withTitle(item, (title) => {
            const episode = title.seasons?.find((s) => s.number === item.season)?.episodes.find((e) => e.id === item.videoId) ?? { id: item.videoId, number: item.episode, title: item.title };
            void playTitle(title, { episode: { season: item.season, episode }, ctx });
          });
        });
        return h(
          'div',
          { class: `alerts-item${item.read ? ' read' : ''}`, role: 'listitem' },
          h('div', { class: 'alerts-poster' }, item.poster ? artImage(item.poster, 'art') : ''),
          h(
            'div',
            { class: 'alerts-text' },
            show,
            h('span', { class: 'alerts-episode' }, `${t('titles.common.episode-code', { season: item.season, episode: item.episode })} · ${episodeName(item.episode, item.title, hiddenFor('unwatched').title)}`),
            h('span', { class: 'alerts-date' }, t('alerts.panel.aired', { date: airedDateText(item.airedAt, locale(), item.exact) })),
          ),
          play,
        );
      }),
    );
  };
  const stopListening = onAlertsChange(render);
  render();

  document.body.append(panel);
  const { width, height } = panel.getBoundingClientRect();
  const at = placeMenu(anchor.getBoundingClientRect(), 8, { width, height }, { width: innerWidth, height: innerHeight }, isRtl());
  panel.style.left = `${at.left}px`;
  panel.style.top = `${at.top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const removeLayer = pushLayer(panel, close);
  (panel.querySelector<HTMLElement>('.alerts-play, .alerts-mark-read:not([hidden])') ?? panel).focus({ preventScroll: true });
}
