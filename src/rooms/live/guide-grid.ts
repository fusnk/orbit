/**
 * The Live TV guide grid: channels down the side, time across the top,
 * programmes as blocks as long as they run, and a line at the current time.
 * Covers half an hour back to twelve hours ahead. Choosing what's on now
 * plays the channel; anything else shows its details above the grid, with
 * "Search for it" (also in each programme's context menu) to find it on the
 * person's addons.
 *
 * When a channel keeps an archive (catch-up), its finished programmes play
 * from the start, and the grid gains earlier days: today then starts at
 * midnight, and each earlier day runs midnight to midnight.
 */
import { nearestDelta } from '../../app/spatial';
import { withContextMenu } from '../../components/menu';
import { errorText } from '../../components/state-message';
import { locale, t } from '../../i18n';
import { formatClock } from '../../lib/clock';
import { h } from '../../lib/dom';
import { canReplay, programmeQuery, tvSchedule, type Showing, type TvChannel } from '../../live/iptv';
import { choices } from '../settings/playback';

const PX_PER_MINUTE = 5;
const SLOT_S = 30 * 60;
const AHEAD_S = 12 * 3600;
const CHANNEL_COLUMN_PX = 220;
/** Matching live.css. */
const HEADER_PX = 36;
const ROW_PX = 64;
/** Earlier days offered, whatever the archives say (the guide keeps a week). */
const MAX_DAYS_BACK = 7;

const clock = (seconds: number) => formatClock(seconds * 1000);
const x = (seconds: number, from: number) => ((seconds - from) / 60) * PX_PER_MINUTE;

/** Local midnight `days` days from today, in Unix seconds. */
function midnight(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return Math.floor(d.getTime() / 1000);
}

/** The local half-hour `seconds` falls in, in Unix seconds (so slots read :00 and :30 in half-hour time zones too). */
export function slotStart(seconds: number): number {
  const offset = new Date(seconds * 1000).getTimezoneOffset() * 60;
  return Math.floor((seconds - offset) / SLOT_S) * SLOT_S + offset;
}

/** This moment `days` days from today, by the calendar (a day across a clock change isn't 24 hours). */
export function sameTimeOn(days: number, now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.getTime() / 1000;
}

/** The day of `seconds` counted from today in calendar days (-1 yesterday), in this computer's time zone. */
export function dayFrom(seconds: number, now = Date.now()): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(new Date(seconds * 1000)) - day(new Date(now))) / 86_400_000);
}

/**
 * The first of a row's programmes (in order) that shows past `edge`, the
 * channel column's right side: where Right from the channel goes. Arrow keys
 * alone would skip the programme on now, which usually began under the
 * (sticky) column and so doesn't lie wholly to its right.
 */
/**
 * Where a redraw scrolls to so the same time stays at the left edge: the grid's start
 * (`from`) moves on with the clock (each half hour, and at midnight with catch-up), so
 * keeping the old pixel offset would slide the view along by as much.
 */
export function keptScrollLeft(scrollLeft: number, drawnFrom: number, from: number): number {
  return Math.max(0, x(drawnFrom + (scrollLeft / PX_PER_MINUTE) * 60, from));
}

export function firstShowing<T extends { right: number }>(cells: readonly T[], edge: number): T | undefined {
  return cells.find((cell) => cell.right > edge + 2);
}

/**
 * How far to scroll so a programme shows beside the (sticky) channel column, whose right side is
 * `edge`, with the grid showing up to `end`. Going left, arrow keys alone moved focus onto earlier
 * programmes hidden under the column, as it still lies inside the grid's box.
 */
export function besideColumn(cell: { left: number; right: number }, edge: number, end: number): number {
  return nearestDelta({ start: cell.left, end: cell.right }, { start: edge, end });
}

function dayName(days: number): string {
  if (days === 0) return t('browse.guide.today');
  if (days === -1) return t('browse.guide.yesterday');
  return new Date(midnight(days) * 1000).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric' });
}

/** CSSOM rather than style attributes: the CSP forbids inline styles. */
/** A channel's logo beside its name; dropped if it doesn't load, as for a channel without one (not a broken-image icon). */
function guideLogo(src: string): HTMLImageElement {
  const img = h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

function place(el: HTMLElement, left: number, width?: number): HTMLElement {
  el.style.setProperty('--x', `${left}px`);
  if (width !== undefined) el.style.setProperty('--w', `${width}px`);
  return el;
}

export function createGuideGrid(options: {
  onPlay(channel: TvChannel): void;
  onReplay(channel: TvChannel, programme: Showing): void;
  onSearch(query: string): void;
  /** Settings → Live TV, where a source's guides are added. */
  onAddGuide(): void;
}) {
  const detail = h('div', { class: 'guide-detail', role: 'status' });
  const days = h('div', { class: 'guide-days', hidden: true });
  // A timeline: left to right in every language (its cells are placed by time in px).
  const scroller = h('div', { class: 'guide-scroller', dir: 'ltr' });
  const element = h('div', { class: 'guide' }, detail, days, scroller);
  let from = 0;
  /** The `from` of the grid on screen (`from` moves on as soon as a redraw starts). */
  let drawnFrom = 0;
  let nowLine: HTMLElement | undefined;
  let drawn = 0;
  /** 0 is today, -1 yesterday, … */
  let day = 0;
  /** The midnight `day` began at, when it's an earlier day (Unix seconds). */
  let dayStart: number | null = null;
  let channels: readonly TvChannel[] = [];

  function describe(channel: TvChannel, p: Showing | null): void {
    if (!p) {
      detail.replaceChildren(h('span', { class: 'guide-detail-title' }, channel.name), h('span', { class: 'muted' }, t('browse.guide.no-info')));
      return;
    }
    const now = Date.now() / 1000;
    const when = p.start <= now && p.stop > now ? t('browse.guide.on-now', { time: clock(p.stop) }) : t('browse.guide.range', { start: clock(p.start), stop: clock(p.stop) });
    detail.replaceChildren(
      h('span', { class: 'guide-detail-title' }, p.title),
      // The time first: on a narrow window the line is cut short, and the channel is already named in its row.
      h('span', { class: 'guide-detail-when' }, [when, channel.name, ...(canReplay(channel, p, now) ? [t('browse.guide.from-start')] : [])].join(' · ')),
      searchButton(p) ?? '',
      p.description ? h('p', { class: 'guide-detail-desc' }, p.description) : '',
    );
  }

  /** "Search for it": the programme's title in Search (none for a title that's only decoration). */
  function searchButton(p: Showing): HTMLButtonElement | null {
    const query = programmeQuery(p.title);
    if (!query) return null;
    const button = h('button', { class: 'button guide-search', title: t('livetv.guide.search-title', { title: query }) }, t('livetv.guide.search'));
    button.addEventListener('click', () => options.onSearch(query));
    return button;
  }

  function programme(channel: TvChannel, p: Showing, to: number): HTMLElement {
    const now = Date.now() / 1000;
    const start = Math.max(p.start, from);
    const left = x(start, from);
    const width = Math.max(4, x(Math.min(p.stop, to), from) - left - 2);
    const onNow = p.start <= now && p.stop > now;
    const cell = h(
      'button',
      { class: `guide-cell${onNow ? ' now' : ''}${p.stop <= now ? ' past' : ''}${canReplay(channel, p, now) ? ' replay' : ''}`, title: `${p.title} · ${t('browse.guide.range', { start: clock(p.start), stop: clock(p.stop) })}` },
      h('span', { class: 'guide-cell-title', dir: 'auto' }, p.title),
      width > 90 ? h('span', { class: 'guide-cell-time' }, clock(p.start)) : '',
    );
    cell.dataset.focusId = `${channel.source}/${channel.key}@${p.start}`;
    cell.dataset.start = String(p.start);
    cell.dataset.stop = String(p.stop);
    cell.dataset.archive = String(channel.archive);
    const show = () => describe(channel, p);
    cell.addEventListener('focus', show);
    cell.addEventListener('pointerenter', show);
    cell.addEventListener('click', () => {
      const t = Date.now() / 1000;
      if (p.start <= t && p.stop > t) options.onPlay(channel);
      else if (canReplay(channel, p, t)) options.onReplay(channel, p);
      else {
        // Nothing to play yet: its details, and the way to find it on the addons.
        describe(channel, p);
        detail.querySelector<HTMLElement>('.guide-search')?.focus({ preventScroll: true });
      }
    });
    const query = programmeQuery(p.title);
    if (query) withContextMenu(cell, () => [{ label: t('livetv.guide.search-title', { title: query }), action: () => options.onSearch(query) }]);
    return place(cell, left, width);
  }

  /** Moves the "now" line and dims what has finished; cheap, run every minute. */
  function tick(): void {
    const now = Date.now() / 1000;
    if (nowLine) place(nowLine, CHANNEL_COLUMN_PX + x(now, from));
    for (const cell of scroller.querySelectorAll<HTMLElement>('.guide-cell')) {
      const start = Number(cell.dataset.start);
      const stop = Number(cell.dataset.stop);
      const archive = Number(cell.dataset.archive);
      cell.classList.toggle('now', start <= now && stop > now);
      cell.classList.toggle('past', stop <= now);
      cell.classList.toggle('replay', canReplay({ archive }, { start, stop }, now));
    }
  }

  /** Today and, when any channel shown keeps an archive, the days it reaches back to. */
  function drawDays(): void {
    // A redraw after midnight stays on the earlier day picked (now one more day back), rather than moving on to the next.
    if (day < 0 && dayStart !== null) day = dayFrom(dayStart);
    const back = Math.min(MAX_DAYS_BACK, Math.max(0, ...channels.map((c) => c.archive)));
    days.hidden = back === 0;
    if (back === 0) {
      day = 0;
      return;
    }
    day = Math.max(day, -back);
    dayStart = day < 0 ? midnight(day) : null;
    const options = Array.from({ length: back + 1 }, (_, i) => [-back + i, dayName(-back + i)] as const);
    days.replaceChildren(
      choices(t('browse.guide.day'), options, day, (picked) => {
        day = picked;
        dayStart = day < 0 ? midnight(day) : null;
        void draw().then(scrollToNow);
      }),
    );
  }

  /** The current time on the day shown (yesterday: this time yesterday), near the left. */
  function scrollToNow(): void {
    // 120px of what's just ended, or less when a narrow guide shows less beside the channel names, so now stays in view.
    const lead = Math.min(120, Math.max(0, scroller.clientWidth - CHANNEL_COLUMN_PX) / 3);
    scroller.scrollLeft = Math.max(0, x(sameTimeOn(day), from) - lead);
  }

  async function draw(): Promise<void> {
    const run = ++drawn;
    const now = Math.floor(Date.now() / 1000);
    const archived = channels.some((c) => c.archive > 0);
    const slot = slotStart(now);
    from = day < 0 ? midnight(day) : archived ? Math.min(midnight(0), slot - SLOT_S) : slot - SLOT_S;
    const to = day < 0 ? midnight(day + 1) : slot + AHEAD_S;
    let failed: unknown = null;
    const schedules = await tvSchedule(channels, from, to).catch((err: unknown) => ((failed = err ?? 'failed'), []));
    if (run !== drawn) return;
    const byChannel = new Map(schedules.map((s) => [`${s.source}/${s.key}`, s.programmes]));
    const width = x(to, from);

    const slots: HTMLElement[] = [];
    for (let t = from; t < to; t += SLOT_S) slots.push(place(h('span', { class: 'guide-slot' }, clock(t)), x(t, from)));
    const header = h('div', { class: 'guide-header' }, h('span', { class: 'guide-corner' }, dayName(day)), place(h('div', { class: 'guide-times' }, ...slots), 0, width));

    const rows = channels.map((channel) => {
      const name = h(
        'button',
        { class: 'guide-channel', title: t('browse.guide.watch', { name: channel.name }), 'data-focus-id': `${channel.source}/${channel.key}@name` },
        channel.logo ? guideLogo(channel.logo) : '',
        h('span', { dir: 'auto' }, channel.name),
      );
      name.addEventListener('click', () => options.onPlay(channel));
      const programmes = byChannel.get(`${channel.source}/${channel.key}`) ?? [];
      const track = place(h('div', { class: 'guide-track' }), 0, width);
      // Before spatial navigation (on the document), which would pass over the programme on now.
      name.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const cells = [...track.querySelectorAll<HTMLElement>('.guide-cell')].map((cell) => ({ cell, right: cell.getBoundingClientRect().right }));
        const target = firstShowing(cells, name.getBoundingClientRect().right)?.cell;
        if (!target) return;
        event.preventDefault();
        target.focus({ preventScroll: true });
        // A gap in the guide can leave the next programme past the visible edge: bring it in beside the (sticky) channel column.
        const left = target.getBoundingClientRect().left;
        if (left >= scroller.getBoundingClientRect().right) scroller.scrollLeft += left - name.getBoundingClientRect().right - 20;
      });
      // Left goes to the programme before (from the first, on to the channel), shown beside the column rather than under it.
      track.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const cells = [...track.querySelectorAll<HTMLElement>('.guide-cell')];
        const target = cells[cells.indexOf(event.target as HTMLElement) - 1];
        event.preventDefault();
        if (!target) return name.focus({ preventScroll: true, focusVisible: true });
        target.focus({ preventScroll: true, focusVisible: true });
        scroller.scrollLeft += besideColumn(target.getBoundingClientRect(), name.getBoundingClientRect().right, scroller.getBoundingClientRect().right);
      });
      if (programmes.length) track.append(...programmes.map((p) => programme(channel, p, to)));
      else {
        const empty = place(h('button', { class: 'guide-cell empty', 'data-focus-id': `${channel.source}/${channel.key}@empty` }, h('span', { class: 'guide-cell-title' }, channel.name)), 0, width - 2);
        empty.addEventListener('focus', () => describe(channel, null));
        empty.addEventListener('click', () => options.onPlay(channel));
        track.append(empty);
      }
      return h('div', { class: 'guide-row' }, name, track);
    });

    nowLine = h('span', { class: 'guide-now', 'aria-hidden': 'true' });
    nowLine.style.setProperty('--h', `${HEADER_PX + rows.length * ROW_PX}px`);
    nowLine.hidden = day < 0;
    // Redrawn on refreshes too: focus and the scroll position stay where they were.
    const focused = document.activeElement instanceof HTMLElement && scroller.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const left = drawnFrom ? keptScrollLeft(scroller.scrollLeft, drawnFrom, from) : 0;
    scroller.replaceChildren(header, ...rows, nowLine);
    drawnFrom = from;
    scroller.scrollLeft = left;
    tick();
    // Empty rows because the guide couldn't be read say so, with a way to try again.
    if (failed !== null) {
      const retry = h('button', { class: 'button guide-detail-action' }, t('browse.search.retry'));
      retry.addEventListener('click', () => void draw());
      detail.replaceChildren(h('span', { class: 'muted' }, errorText(failed, { service: 'iptv' })), retry);
    } else if (channels.length && schedules.every((s) => !s.programmes.length)) {
      // No programme at all (a playlist without a guide, or one still downloading): the hint would ask to choose one.
      const add = h('button', { class: 'button guide-detail-action' }, t('livetv.guides.add'));
      add.addEventListener('click', () => options.onAddGuide());
      detail.replaceChildren(h('span', { class: 'muted' }, t('livetv.guide.none')), add);
    } else detail.replaceChildren(h('span', { class: 'muted' }, archived ? t('browse.guide.hint-archive') : t('browse.guide.hint')));
    if (focused) scroller.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  return {
    element,
    tick,
    /** Draws the grid for `shown` (already filtered by group and search). */
    render(shown: readonly TvChannel[]): Promise<void> {
      channels = shown;
      drawDays();
      return draw();
    },
    /** Back to today, with the current time near the left. */
    async scrollToNow(): Promise<void> {
      if (day !== 0) {
        day = 0;
        drawDays();
        await draw();
      }
      scrollToNow();
    },
  };
}
