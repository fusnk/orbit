/**
 * How the player's controls are laid out (Settings → Player): a preset plus a
 * few switches. A preset is mostly CSS keyed on data attributes on the player
 * root (layout.css); the same controls are restyled or moved, never copied,
 * so keyboard, remote and mouse behave the same in every preset. The little
 * DOM a preset needs that the player lacks (Streaming's title block, TV's
 * button labels, the clock, language badges, Arc's source line) is added here.
 *
 * Not 'player.look': that key is already the picture's look (adjustments.ts).
 */
import * as v from 'valibot';
import { displayYear, type Title } from '../../catalog/titles';
import { locale, t } from '../../i18n';
import { episodeLine } from './format';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { languageKey, languageName, UNKNOWN_LANGUAGE } from '../../lib/languages';
import { clock } from '../../live/surf';
import type { EpisodeRef } from '../detail/title-actions';
import type { UpNext } from './next-up';
import { PANEL_TITLES, upNextName } from './panels';
import { clockTime, finishTime } from './time-readout';
import type { TrackInfo } from './tracks';
import './layout.css';

export const PLAYER_LAYOUT_KEY = 'player.layout';

export const PRESETS = ['orbit', 'minimal', 'streaming', 'theater', 'cinema', 'compact', 'floating', 'tv', 'arc'] as const;
export const SIZES = ['compact', 'standard', 'large'] as const;
export const BACKGROUNDS = ['none', 'gradient', 'blur'] as const;
export const TIMELINES = ['line', 'accent', 'chapters'] as const;

export type Preset = (typeof PRESETS)[number];

export interface PlayerLayout {
  preset: Preset;
  /** Custom control scale; absent uses the existing size preset. */
  scale?: number;
  size: (typeof SIZES)[number];
  background: (typeof BACKGROUNDS)[number];
  timeline: (typeof TIMELINES)[number];
  title: boolean;
  badges: boolean;
  next: boolean;
  chapters: boolean;
  clock: boolean;
}

/** The control scale each size gives (layout.css's `--ps-size` for `data-size`). */
export const SIZE_SCALES: Record<(typeof SIZES)[number], number> = { compact: 0.85, standard: 1, large: 1.2 };

/**
 * `layout` with the controls at `scale`: a size's own scale is saved as that size (so Settings → Player
 * shows it), any other as a custom scale over it.
 */
export function withControlScale(layout: PlayerLayout, scale: number): PlayerLayout {
  const size = SIZES.find((name) => SIZE_SCALES[name] === scale);
  const next: PlayerLayout = size ? { ...layout, size } : { ...layout, scale };
  if (size) delete next.scale;
  return next;
}

/** Today's player: Orbit with every switch as it always was. */
export const DEFAULT_LAYOUT: PlayerLayout = { preset: 'orbit', size: 'standard', background: 'gradient', timeline: 'line', title: true, badges: true, next: true, chapters: true, clock: false };

/** What picking a preset sets; the switches can then be changed on top. The clock is left alone. */
const PRESET_DEFAULTS: Record<Preset, Omit<PlayerLayout, 'preset' | 'clock'>> = {
  orbit: { size: 'standard', background: 'gradient', timeline: 'line', title: true, badges: true, next: true, chapters: true },
  minimal: { size: 'standard', background: 'gradient', timeline: 'line', title: false, badges: false, next: false, chapters: false },
  streaming: { size: 'standard', background: 'gradient', timeline: 'accent', title: true, badges: true, next: true, chapters: true },
  theater: { size: 'standard', background: 'gradient', timeline: 'accent', title: true, badges: true, next: true, chapters: true },
  // No next button: the Next Up card and N cover it, and the bar keeps to three small icons (see cinema.ts).
  cinema: { size: 'standard', background: 'gradient', timeline: 'line', title: true, badges: true, next: false, chapters: true },
  compact: { size: 'compact', background: 'gradient', timeline: 'line', title: false, badges: false, next: false, chapters: true },
  floating: { size: 'standard', background: 'blur', timeline: 'accent', title: true, badges: true, next: true, chapters: true },
  tv: { size: 'standard', background: 'gradient', timeline: 'accent', title: true, badges: true, next: true, chapters: true },
  arc: { size: 'standard', background: 'gradient', timeline: 'line', title: true, badges: true, next: true, chapters: true },
};

// Field by field: a bad value falls back on its own, the rest are kept.
const LayoutSchema = v.object({
  preset: v.fallback(v.picklist(PRESETS), DEFAULT_LAYOUT.preset),
  size: v.fallback(v.picklist(SIZES), DEFAULT_LAYOUT.size),
  background: v.fallback(v.picklist(BACKGROUNDS), DEFAULT_LAYOUT.background),
  timeline: v.fallback(v.picklist(TIMELINES), DEFAULT_LAYOUT.timeline),
  title: v.fallback(v.boolean(), DEFAULT_LAYOUT.title),
  badges: v.fallback(v.boolean(), DEFAULT_LAYOUT.badges),
  next: v.fallback(v.boolean(), DEFAULT_LAYOUT.next),
  chapters: v.fallback(v.boolean(), DEFAULT_LAYOUT.chapters),
  clock: v.fallback(v.boolean(), DEFAULT_LAYOUT.clock),
});

/** The saved layout; junk (e.g. from a hand-edited backup) falls back to the defaults. */
export function parsePlayerLayout(value: unknown): PlayerLayout {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  const result = v.safeParse(LayoutSchema, saved);
  const scale = v.safeParse(v.pipe(v.number(), v.minValue(0.7), v.maxValue(1.4)), (saved as Record<string, unknown>).scale);
  return { ...(result.success ? result.output : DEFAULT_LAYOUT), ...(scale.success ? { scale: scale.output } : {}) };
}

/** Switches to `preset` with its own defaults (the clock stays as it was). */
export function choosePreset(layout: PlayerLayout, preset: Preset): PlayerLayout {
  return { ...PRESET_DEFAULTS[preset], preset, clock: layout.clock };
}

const onOff = (on: boolean) => (on ? 'on' : 'off');

/** The data attributes layout.css keys on (also drawn by the preview in Settings). */
export function layoutAttributes(layout: PlayerLayout): Record<string, string> {
  return {
    layout: layout.preset,
    size: layout.size,
    controlsBg: layout.background,
    timeline: layout.timeline,
    titleInfo: onOff(layout.title),
    badges: onOff(layout.badges),
    nextButton: onOff(layout.next),
    // The Chapters timeline is drawn from the chapter marks, so it shows them either way.
    chapterMarks: onOff(layout.chapters || layout.timeline === 'chapters'),
    clock: onOff(layout.clock),
  };
}

export function applyLayoutAttributes(el: HTMLElement, layout: PlayerLayout): void {
  Object.assign(el.dataset, layoutAttributes(layout));
  if (layout.scale === undefined) el.style.removeProperty('--ps-size');
  else el.style.setProperty('--ps-size', String(layout.scale));
}

/** The playing audio's language and the subtitles' code, e.g. ["French", "EN"]; unknown ones are left out. */
export function languageBadges(tracks: readonly TrackInfo[]): string[] {
  const audio = languageKey(tracks.find((track) => track.kind === 'audio' && track.selected)?.lang);
  const sub = languageKey(tracks.find((track) => track.kind === 'sub' && track.selected && !track.secondary)?.lang);
  return [audio !== UNKNOWN_LANGUAGE ? languageName(audio) : '', sub !== UNKNOWN_LANGUAGE ? sub.toUpperCase() : ''].filter(Boolean);
}

// ── Live changes from Settings while a player is open ──
const listeners = new Set<(layout: PlayerLayout) => void>();

/** Settings changed the layout: any open player follows at once. */
export function layoutChanged(layout: PlayerLayout): void {
  for (const listener of listeners) listener(layout);
}

/** Calls `listener` on each change from Settings (a Look, or the Player page); returns a way to stop. */
export function watchPlayerLayout(listener: (layout: PlayerLayout) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadPlayerLayout(): Promise<PlayerLayout> {
  return parsePlayerLayout(await settings.get(PLAYER_LAYOUT_KEY).catch(() => null));
}

/** How long Streaming's title block stays up after playback starts. */
const INFO_AT_START_MS = 8000;
/** Streaming's description: its most lines (layout.css), and the room it keeps above the centred transport. */
const INFO_SUMMARY_LINES = 3;
const INFO_CLEARANCE = 16;
/** In Minimal, how long the extra buttons stay after the last input. */
const ENGAGED_MS = 2800;
/** The volume slider's width when open (player.css: 96px and its margins). */
const VOLUME_SLIDER_OPEN = 108;
/** Room kept between Arc's capsule and the buttons beside it. */
const ARC_GAP = 16;
/** The title's room in a one-row bar, in buttons' widths, before other things give way to it. */
const NAME_ROOM_BUTTONS = 4;
/** What gives way in a crowded bar (layout.css: hidden and out of the row, but keeping its size, so it's measured as if shown). */
const GIVES_WAY = '.layout-badges, .layout-secondary';

/** Whether `el` takes room in its row of the bar (or would, but has given way). */
function inRow(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && (style.position === 'static' || style.position === 'relative' || el.matches(GIVES_WAY));
}

function outerWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.offsetWidth + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
}

/** The width a row of the bar needs for what's in it, the volume slider open. */
function rowWidth(row: HTMLElement, mute: HTMLElement): number {
  const items = [...row.children].filter((el): el is HTMLElement => el instanceof HTMLElement && inRow(el));
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  return items.reduce((sum, el) => sum + gap + (el.contains(mute) ? mute.offsetWidth + VOLUME_SLIDER_OPEN : outerWidth(el)), -gap);
}

export interface LayoutHost {
  view: HTMLElement;
  top: HTMLElement;
  bottom: HTMLElement;
  /** The quality badge; the language badges join it. */
  quality: HTMLElement;
  /** The title and episode in the bar; Arc adds the source's name under them. */
  name: HTMLElement;
  nextButton: HTMLElement;
  /** Buttons that show a text label in presets that have room (TV, Streaming's Next card). */
  labelled: { episodes: HTMLElement; tracks: HTMLElement; speed: HTMLElement; queue: HTMLElement };
  /** Buttons Compact's single bar leaves out (picture in picture keeps its I shortcut). */
  secondary: HTMLElement[];
  request(): { title: Title; episode?: EpisodeRef | undefined; live?: boolean | undefined; source: { addon: string } };
  /** What plays next (the queue's first item, or the next episode). */
  upNext(): UpNext | undefined;
  status(): { paused: boolean; timePos: number | null; duration: number | null; speed: number | null };
  started(): boolean;
}

export function createPlayerLayout(host: LayoutHost) {
  let startedAt = 0;
  let engagedTimer: number | undefined;
  let clockTimer: number | undefined;
  let clockOn = false;
  let hasEnd = false;

  const label = (text: string) => h('span', { class: 'layout-label', 'aria-hidden': 'true' }, text);
  for (const key of ['episodes', 'tracks', 'speed', 'queue'] as const) {
    host.labelled[key].classList.add('has-label');
    host.labelled[key].append(label(PANEL_TITLES[key === 'tracks' ? 'hub' : key]));
  }
  // Next: "Next episode" and which one, as a card in Streaming and a labelled button on TV.
  const nextName = h('span', { class: 'layout-next-name' });
  host.nextButton.classList.add('has-label', 'layout-next-button');
  host.nextButton.append(h('span', { class: 'layout-label layout-next', 'aria-hidden': 'true' }, h('span', { class: 'layout-next-eyebrow' }, t('playerlook.next.label')), nextName));

  for (const el of host.secondary) el.classList.add('layout-secondary');

  // The quality badge and the language badges, as one group (TV moves it under the title).
  const languages = h('span', { class: 'layout-languages', hidden: true });
  const badges = h('span', { class: 'layout-badges' });
  host.quality.replaceWith(badges);
  badges.append(host.quality, languages);

  // What the bar's buttons need varies (a series has more; the volume slider opens on hover; the size
  // setting scales them), so whether they fit is measured, not guessed from the window's width, and
  // always with the slider open, so hovering the volume never reflows the bar.
  // Arc's capsule sits in the middle of the bar: when the buttons at its end would reach it, its three
  // buttons join the row instead (data-cramped). In a one-row bar, when the buttons would leave the
  // title too little room, the badges give way, then the lock and picture in picture
  // (data-crowded; layout.css). Both are measured at the buttons' full count (what gives way keeps
  // its size while hidden), so neither can flip the other back and forth.
  const bar = host.bottom.querySelector<HTMLElement>('.player-bar');
  const barStart = bar?.querySelector<HTMLElement>('.player-bar-start');
  const barEnd = bar?.querySelector<HTMLElement>('.player-bar-end');
  const mute = bar?.querySelector<HTMLElement>('.player-volume button');
  const fit = new ResizeObserver(() => {
    if (!bar || !barStart || !barEnd || !mute) return;
    const capsule = parseFloat(getComputedStyle(bar, '::before').width) || 0;
    const room = bar.clientWidth / 2 - capsule / 2 - ARC_GAP;
    const end = rowWidth(barEnd, mute);
    host.view.toggleAttribute('data-cramped', end + mute.offsetWidth + VOLUME_SLIDER_OPEN + ARC_GAP > room);

    const style = getComputedStyle(bar);
    if (style.display !== 'grid' && !(style.display === 'flex' && style.flexDirection === 'row')) {
      host.view.removeAttribute('data-crowded');
      return;
    }
    // Room for about four buttons' width of title, unless the preset hides it (Streaming's title block).
    const name = host.name.querySelector('.player-title')?.checkVisibility({ visibilityProperty: true }) ? NAME_ROOM_BUTTONS * mute.offsetWidth : 0;
    const gap = (parseFloat(style.columnGap) || 0) * 2;
    const need = (cut: number) => rowWidth(barStart, mute) + end - cut + name + gap;
    const crowded = need(0) <= bar.clientWidth ? null : need(inRow(badges) ? outerWidth(badges) : 0) <= bar.clientWidth ? 'badges' : 'extras';
    if (crowded) host.view.dataset.crowded = crowded;
    else host.view.removeAttribute('data-crowded');
  });
  for (const el of [bar, barEnd, badges, host.name]) if (el) fit.observe(el);

  const clockText = h('span', { class: 'layout-clock', 'aria-hidden': 'true' });
  host.top.querySelector('.player-top-end')?.prepend(clockText);

  // Streaming's title block: name, year and runtime, and a short description.
  const info = h('div', { class: 'layout-info' });
  host.top.append(info);

  // The description runs down toward the centred transport: on a short window (or with large controls)
  // it keeps only the lines that end above the buttons beside it, or none. Measured, as the title above
  // it wraps to one line or two.
  const fitInfo = new ResizeObserver(() => {
    const summary = info.querySelector<HTMLElement>('.layout-info-summary');
    if (!summary) return;
    summary.style.removeProperty('display');
    summary.style.removeProperty('-webkit-line-clamp');
    if (getComputedStyle(info).display === 'none') return;
    const box = summary.getBoundingClientRect();
    const beside = [...host.bottom.querySelectorAll<HTMLElement>('.player-bar-start > :is(.large, .skip)')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.left < box.right && r.right > box.left);
    if (!beside.length) return;
    const lines = Math.floor((Math.min(...beside.map((r) => r.top)) - INFO_CLEARANCE - box.top) / parseFloat(getComputedStyle(summary).lineHeight));
    if (lines <= 0) summary.style.display = 'none';
    else if (lines < INFO_SUMMARY_LINES) summary.style.setProperty('-webkit-line-clamp', String(lines));
  });
  fitInfo.observe(info);
  fitInfo.observe(host.view);

  /** The time now, and when what's playing ends ("1:08 AM · Ends at 2:05 AM"); live TV has no end. */
  function tickClock(): void {
    const now = Date.now();
    const { timePos, duration, speed } = host.status();
    const ends = !host.request().live && duration && timePos !== null ? t('showcase.ends-at', { time: clockTime(finishTime(now, timePos, duration, speed ?? 1), locale()) }) : '';
    hasEnd = !!ends;
    clockText.textContent = ends ? `${clock(now / 1000)} · ${ends}` : clock(now / 1000);
  }

  let layoutChanges = 0;
  function apply(layout: PlayerLayout): void {
    layoutChanges++;
    applyLayoutAttributes(host.view, layout);
    if (layout.clock === clockOn) return;
    clockOn = layout.clock;
    window.clearInterval(clockTimer);
    if (clockOn) {
      tickClock();
      clockTimer = window.setInterval(tickClock, 15_000);
    }
  }

  function renderNext(): void {
    const next = host.upNext();
    nextName.textContent = next ? upNextName(next, host.request().title) : '';
  }

  listeners.add(apply);
  void loadPlayerLayout().then((layout) => {
    if (listeners.has(apply) && !layoutChanges) apply(layout);
  });

  return {
    /** The title, episode or what follows changed. */
    renderRequest(): void {
      hasEnd = false;
      const { title, episode } = host.request();
      renderNext();
      const meta = [episode ? episodeLine(episode.season, episode.episode.number, episode.episode.title) : '', displayYear(title.year) ?? '', title.runtime ?? ''].filter(Boolean).join(' · ');
      const summary = episode?.episode.overview ?? title.description;
      info.replaceChildren(
        h('span', { class: 'layout-info-title' }, title.name),
        meta ? h('span', { class: 'layout-info-meta' }, meta) : '',
        summary ? h('p', { class: 'layout-info-summary' }, summary) : '',
      );
      // Arc's title block ends with where it plays from (the top's Source button still switches it).
      host.name.append(h('span', { class: 'layout-source', 'aria-hidden': 'true' }, host.request().source.addon));
      startedAt = 0;
    },
    /** What plays next changed (e.g. the queue). */
    renderNext,
    /** After each status: Streaming's title block shows while paused and for a moment after starting. */
    render(): void {
      if (host.started() && !startedAt) startedAt = Date.now();
      // The end time appears as soon as the length is known, not at the next 15-second tick.
      if (clockOn && !hasEnd && host.status().duration) tickClock();
      host.view.classList.toggle('layout-info-on', host.started() && (host.status().paused || Date.now() - startedAt < INFO_AT_START_MS));
    },
    setTracks(tracks: readonly TrackInfo[]): void {
      const parts = languageBadges(tracks);
      languages.hidden = !parts.length;
      languages.replaceChildren(...parts.map((part) => h('span', { class: 'layout-badge' }, part)));
    },
    /** The mouse or keyboard was used: Minimal shows its other buttons for a while. */
    wake(): void {
      host.view.classList.add('engaged');
      window.clearTimeout(engagedTimer);
      engagedTimer = window.setTimeout(() => host.view.classList.remove('engaged'), ENGAGED_MS);
    },
    dispose(): void {
      fit.disconnect();
      fitInfo.disconnect();
      listeners.delete(apply);
      window.clearTimeout(engagedTimer);
      window.clearInterval(clockTimer);
    },
  };
}
