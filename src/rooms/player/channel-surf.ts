/**
 * Channel surfing while a Live TV channel plays: Up/Down (and Page Up/Down,
 * the media track keys, a remote's or controller's d-pad) step through the
 * list the channel was opened from. A card shows the channel and what's on
 * at once; the player only tunes once the presses stop, so flicking past five
 * channels opens one stream, not five. E (remappable in Settings → Shortcuts)
 * or the Channels button opens a side list of the channels around this one.
 *
 * Its keys are handled before the player's (keys.ts): for a live channel
 * Up/Down surf instead of changing the volume (the volume keeps its slider,
 * the mouse wheel and the M key).
 */
import { icon } from '../../components/icons';
import { isRtl, locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { actionForEvent, keymap } from '../../lib/keymap';
import { tvGuide, type TvChannel, type TvGuide } from '../../live/iptv';
import { channelLogo, channelRequest, clock, debounce, nearby, progressBar, progressOf, sameChannel, setSurfing, stepIndex, surfingChannel, surfList } from '../../live/surf';
import type { PlayRequest } from './index';
import './channel-surf.css';

/** Tune once presses have stopped this long. */
const TUNE_DELAY_MS = 600;
/** The card stays this long after the last press. */
const CARD_MS = 3500;
/** Channels listed either side of the current one in the side list. */
const LIST_RADIUS = 20;
/** What's on is looked up again after this long. */
const GUIDE_TTL_MS = 60_000;

export interface SurfHost {
  view: HTMLElement;
  bar: HTMLElement;
  /** The player's own floating panel (tracks, speed…). */
  panel: HTMLElement;
  request(): PlayRequest;
  load(request: PlayRequest): void;
  closed(): boolean;
  /** The loading screen is asking whether to resume. */
  asking(): boolean;
  /** Whether `el` is one of the player's own controls or its panel (arrows move between those). */
  inControls(el: Element | null): boolean;
  closePanel(): void;
  showControls(): void;
}

const id = (c: { source: string; key: string }) => `${c.source}/${c.key}`;
/** The player is left to right (its timeline), but the card and list are text: they follow the language. */
const textDirection = () => (isRtl() ? 'rtl' : 'ltr');

export function createChannelSurf(host: SurfHost) {
  const guides = new Map<string, { guide: TvGuide; at: number }>();
  /** The list being surfed and where in it the presses have got to (before tuning). */
  let list: readonly TvChannel[] = [];
  let target = -1;
  let cardTimer: number | undefined;
  let open = false;

  const card = h('div', { class: 'surf-card', role: 'status', dir: textDirection(), hidden: true });
  // The player's tooltip names it with E's current key (see tooltips.ts).
  const button = h('button', { class: 'player-button surf-button', 'data-tooltip-action': 'player.channels', 'aria-label': t('livetv.channels.button') }, icon('list'));
  button.addEventListener('click', () => toggle());
  host.bar.querySelector('.player-bar-end')?.prepend(button);

  // Channel buttons (a list role here would need list items, which would take their button role away).
  const rows = h('div', { class: 'surf-rows' });
  const closeButton = h('button', { class: 'player-panel-close', title: t('player.controls.close'), 'aria-label': t('player.controls.close') }, icon('close'));
  closeButton.addEventListener('click', () => close());
  const panel = h(
    'div',
    { class: 'surf-panel', role: 'dialog', dir: textDirection(), 'aria-label': t('livetv.channels.title'), hidden: true },
    h('div', { class: 'player-panel-header' }, h('h2', { class: 'player-panel-title' }, t('livetv.channels.title')), closeButton),
    rows,
  );

  /** What's on for these channels, from the cache where it's fresh. */
  async function guideFor(channels: readonly TvChannel[]): Promise<void> {
    const now = Date.now();
    const stale = channels.filter((c) => (guides.get(id(c))?.at ?? 0) < now - GUIDE_TTL_MS);
    if (!stale.length) return;
    const found = await tvGuide(stale).catch(() => [] as TvGuide[]);
    for (const g of found) guides.set(id(g), { guide: g, at: now });
  }

  function onNow(c: TvChannel): HTMLElement[] {
    const g = guides.get(id(c))?.guide;
    if (!g?.now) return [h('span', { class: 'surf-now muted' }, c.group ?? '')];
    return [h('span', { class: 'surf-now' }, g.now.title), progressBar(progressOf(g.now))];
  }

  function drawCard(c: TvChannel, index: number): void {
    const g = guides.get(id(c))?.guide;
    card.replaceChildren(
      channelLogo(c, 'surf-logo'),
      h(
        'div',
        { class: 'surf-card-text' },
        h('span', { class: 'surf-card-top' }, h('span', { class: 'surf-number' }, t('livetv.surf.position', { index: index + 1, count: list.length })), h('span', { class: 'surf-name' }, c.name)),
        g?.now ? h('span', { class: 'surf-card-now' }, h('span', { class: 'surf-label' }, t('browse.live.now')), h('span', { class: 'surf-title' }, g.now.title), h('span', { class: 'surf-until muted' }, t('livetv.surf.until', { time: clock(g.now.stop) }))) : h('span', { class: 'surf-card-now muted' }, guides.has(id(c)) ? t('livetv.surf.no-guide') : ''),
        g?.now ? progressBar(progressOf(g.now)) : '',
        g?.next ? h('span', { class: 'surf-card-next muted' }, h('span', { class: 'surf-label' }, t('livetv.surf.next')), t('browse.live.next', { time: clock(g.next.start), title: g.next.title })) : '',
      ),
    );
  }

  function showCard(c: TvChannel, index: number): void {
    drawCard(c, index);
    card.hidden = false;
    window.clearTimeout(cardTimer);
    cardTimer = window.setTimeout(() => (card.hidden = true), CARD_MS);
    if (!guides.has(id(c)) || (guides.get(id(c))?.at ?? 0) < Date.now() - GUIDE_TTL_MS) {
      void guideFor([c]).then(() => {
        if (!card.hidden && list[target] === c) drawCard(c, index);
      });
    }
  }

  /** Set from the first press until tuning, so quick presses all count from the same start. */
  let start: Promise<void> | null = null;

  function tuneTo(c: TvChannel): void {
    tune.cancel();
    start = null;
    const playing = surfingChannel();
    if (playing && sameChannel(playing, c)) return;
    setSurfing(c, list);
    host.load(channelRequest(c));
    if (open) drawRows();
  }
  const tune = debounce(TUNE_DELAY_MS, () => {
    const c = list[target];
    start = null;
    if (c && !host.closed()) tuneTo(c);
  });

  async function surf(step: number): Promise<void> {
    start ??= surfList().then((found) => {
      list = found;
      const playing = surfingChannel();
      target = playing ? list.findIndex((c) => sameChannel(c, playing)) : -1;
    });
    await start;
    if (host.closed()) return;
    if (!list.length) {
      start = null;
      return;
    }
    // Not in the list (e.g. it's gone from the provider's): start from an end.
    const from = target < 0 ? (step > 0 ? -1 : 0) : target;
    target = stepIndex(list.length, from, step);
    const c = list[target]!;
    showCard(c, target);
    tune.call();
  }

  // ── The side list ──
  function drawRows(takeFocus = false): void {
    const playing = surfingChannel();
    const at = playing ? list.findIndex((c) => sameChannel(c, playing)) : -1;
    const focused = document.activeElement instanceof HTMLElement && rows.contains(document.activeElement) ? document.activeElement.dataset.channel : undefined;
    const shown = nearby(list.length, Math.max(0, at), LIST_RADIUS);
    if (!shown.length) {
      rows.replaceChildren(h('p', { class: 'surf-empty muted' }, t('livetv.channels.empty')));
      return;
    }
    rows.replaceChildren(
      ...shown.map((i) => {
        const c = list[i]!;
        const current = !!playing && sameChannel(c, playing);
        const row = h(
          'button',
          { class: 'surf-row', 'aria-current': String(current), 'data-channel': id(c) },
          h('span', { class: 'surf-row-number' }, (i + 1).toLocaleString(locale())),
          channelLogo(c, 'surf-row-logo'),
          h('span', { class: 'surf-row-text' }, h('span', { class: 'surf-row-name' }, c.name), ...onNow(c)),
        );
        row.addEventListener('click', () => tuneTo(c));
        return row;
      }),
    );
    const again = rows.querySelector<HTMLElement>(`[data-channel="${CSS.escape(focused ?? (playing ? id(playing) : ''))}"]`) ?? rows.querySelector<HTMLElement>('.surf-row');
    if (open && (takeFocus || focused)) again?.focus({ preventScroll: true });
    if (again) reveal(again, 'center');
  }

  /** Scrolls the list (only the list: scrollIntoView could move the page behind the player). */
  function reveal(row: HTMLElement, where: 'center' | 'nearest'): void {
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (where === 'center') rows.scrollTop = top - (rows.clientHeight - row.offsetHeight) / 2;
    else if (top < rows.scrollTop) rows.scrollTop = top;
    else if (bottom > rows.scrollTop + rows.clientHeight) rows.scrollTop = bottom - rows.clientHeight;
  }

  /** What had focus when the list opened: its button, or nothing (E from the picture). */
  let returnTo: Element | null = null;

  async function openList(): Promise<void> {
    returnTo = document.activeElement;
    open = true;
    host.closePanel();
    card.hidden = true;
    panel.hidden = false;
    button.classList.add('open');
    rows.replaceChildren(h('p', { class: 'surf-empty muted' }, t('livetv.channels.loading')));
    list = await surfList();
    if (!open) return;
    drawRows(true);
    const playing = surfingChannel();
    const at = playing ? list.findIndex((c) => sameChannel(c, playing)) : -1;
    await guideFor(nearby(list.length, Math.max(0, at), LIST_RADIUS).map((i) => list[i]!));
    if (open) drawRows();
  }

  function close(): void {
    if (!open) return;
    open = false;
    panel.hidden = true;
    button.classList.remove('open');
    if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return;
    // Opened with E from the picture: back to it, so Up/Down surf again.
    if (returnTo === button) button.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  const toggle = () => (open ? close() : void openList());

  /** Up/Down inside the side list move between its rows. */
  function moveInList(step: 1 | -1): void {
    const all = [...rows.querySelectorAll<HTMLElement>('.surf-row')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = all[Math.min(all.length - 1, Math.max(0, at + step))];
    if (!next) return;
    next.focus({ preventScroll: true });
    reveal(next, 'nearest');
  }

  // ── Keys (before keys.ts) ──
  function onKey(event: KeyboardEvent): void {
    // The list's key is in the keymap (E unless changed in Settings → Shortcuts).
    const listKey = actionForEvent(keymap(), 'player', event, true) === 'player.channels';
    if (((event.ctrlKey || event.altKey || event.metaKey) && !listKey) || host.closed() || host.asking() || !host.request().live) return;
    if (event.target instanceof Node && event.target !== document.body && !host.view.contains(event.target)) return;
    const active = document.activeElement;
    const claim = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const inList = open && !!active && panel.contains(active);
    if (inList) {
      host.showControls();
      if (listKey) {
        claim();
        close();
        return;
      }
      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
          claim();
          moveInList(event.key === 'ArrowDown' ? 1 : -1);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          claim();
          return;
        case 'Escape':
          claim();
          close();
          return;
        case ' ':
          // Space picks the focused channel, as Enter does, rather than pausing.
          event.stopImmediatePropagation();
          return;
        default:
          return;
      }
    }
    if (listKey) {
      if (active && host.panel.contains(active)) return;
      claim();
      host.showControls();
      if (!event.repeat) toggle();
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (host.inControls(active)) return;
        claim();
        host.showControls();
        void surf(event.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'PageUp':
      case 'PageDown':
      case 'MediaTrackNext':
      case 'MediaTrackPrevious':
        // As in keys.ts: inside the player's panel, Page Up/Down scroll it.
        if (event.key.startsWith('Page') && active && host.panel.contains(active)) return;
        claim();
        host.showControls();
        void surf(event.key === 'PageDown' || event.key === 'MediaTrackNext' ? 1 : -1);
        break;
      case 'Escape':
        if (!open) return;
        claim();
        close();
        break;
    }
  }
  document.addEventListener('keydown', onKey, { capture: true });

  // A click outside the side list closes it (rather than also pausing).
  function onClick(event: MouseEvent): void {
    if (!open || !(event.target instanceof Element) || panel.contains(event.target) || button.contains(event.target)) return;
    if (host.inControls(event.target)) return close();
    event.stopPropagation();
    close();
  }
  host.view.addEventListener('click', onClick, { capture: true });

  return {
    elements: [card, panel] as const,
    /** Back (Backspace) with the side list open: closes it, as Esc does; true if it did. */
    dismiss(): boolean {
      if (!open) return false;
      close();
      return true;
    },
    dispose(): void {
      tune.cancel();
      window.clearTimeout(cardTimer);
      document.removeEventListener('keydown', onKey, { capture: true });
      host.view.removeEventListener('click', onClick, { capture: true });
    },
  };
}
