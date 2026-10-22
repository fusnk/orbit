/**
 * The contents of the player's floating panel: the views the settings hub
 * opens (audio, subtitles, timing, speed, picture, sound…), source,
 * episodes and info. Each builder takes the data to show and callbacks;
 * the player owns the state and redraws a panel when its data changes.
 */
import type { StreamSubtitles } from '../../catalog/service';
import type { Episode, Season, Title } from '../../catalog/titles';
import { favouriteHeart } from '../../components/favourite-heart';
import { icon, type IconName } from '../../components/icons';
import { createSlider } from '../../components/slider';
import { createSwitch } from '../../components/switch';
import { beginEditing, createTextField } from '../../components/text-field';
import { locale, t, tn, type MessageKey } from '../../i18n';
import type { AutoplayGate } from '../../lib/autoplay';
import { h } from '../../lib/dom';
import { languageKey, languageName } from '../../lib/languages';
import { addonGroups, fromAddon, offerAddonFilter } from '../../lib/source-filter';
import type { QueueItem } from '../../library/queue';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState } from '../../library/watch';
import type { FailureReason } from './failed-sources';
import { BAND_NAMES, runsToEnd, type Chapter, type Segment } from './skip';
import type { Picture, PictureQuality } from './picture';
import { pictureControls } from './picture-controls';
import { POSITION_BOTTOM, POSITION_HIGHEST, SIZE_DEFAULT, SIZE_MAX, SIZE_MIN, SIZE_STEP, SUBTITLE_COLORS, SUBTITLE_OUTLINES, type SubtitleStyle } from './subtitle-style';
import { parseHex } from '../../theme/accent';
import { chapterName } from './chapters';
import { watchedMarks, watchedToggle } from './episode-marks';
import { formatNumber, formatTime, parseSeconds } from './format';
import { timingNote, withKey } from './keys';
import type { UpNext } from './next-up';
import { SOUND_HINTS, SOUND_MODES, SOUND_NAMES, type SoundMode } from './sound';
import { isPreset, SPEED_PRESETS, speedLabel, stepSpeed } from './speed';
import { audioLabel, type SubtitleGroup, type SubtitleOption, type TrackInfo } from './tracks';
import './favourite.css';
import { applySubtitleCss } from './subtitle-css';
import { SUBTITLE_FONTS } from './subtitle-style';
import { SIZE_SCALES, type PlayerLayout } from './layout';
import { VOLUME_BOOST_LEVELS, type VolumeBoostLevel } from './player-settings';

/**
 * What the floating panel shows. 'hub' is the settings hub (hub.ts); the
 * views after it open from the hub (or straight from a button or key) and
 * each shows one part of what the old Audio & subtitles and Playback &
 * picture panels held.
 */
export type PanelKind = 'hub' | 'audio' | 'subtitles' | 'subtitle-style' | 'timing' | 'speed' | 'sleep' | 'picture' | 'sound' | 'source' | 'files' | 'episodes' | 'queue' | 'info' | 'transcript' | 'chapters' | 'copy-link' | 'controls-size';

export const PANEL_TITLES: Record<PanelKind, string> = {
  'controls-size': t('trybox.controls.title'),
  hub: t('playerplus.hub.title'),
  transcript: t('player.transcript.title'),
  audio: t('player.tracks.audio'),
  subtitles: t('player.tracks.subtitles'),
  'subtitle-style': t('pstream.style.title'),
  timing: t('player.tracks.timing'),
  speed: t('player.speed.label'),
  sleep: t('player.sleep.label'),
  picture: t('playerplus.hub.picture'),
  sound: t('playerplus.hub.sound'),
  source: t('player.panel.source'),
  files: t('player.files.title'),
  episodes: t('player.panel.episodes'),
  queue: t('watching.queue.title'),
  info: t('player.panel.info'),
  chapters: t('player.chapters.title'),
  'copy-link': t('player.copy-link.action'),
};

/** A source the player can switch to. The URL stays in memory, never in the DOM. */
export interface PlayableSource {
  id: string;
  url: string;
  addon: string;
  /** e.g. "1080p". */
  label: string;
  /** e.g. "HDR10 · x265 · 2.1 GB". */
  meta: string;
  filename?: string | undefined;
  videoSize?: number | undefined;
  /** The OpenSubtitles hash the addon gave, for subtitle addons. */
  videoHash?: string | undefined;
  /** Addons tag releases that continue across episodes (same group, quality, language). */
  bingeGroup?: string | undefined;
  /** Headers the addon asked for with this stream (see addons/proxy-headers.ts); Rust sends them for its address only. */
  headers?: Record<string, string> | undefined;
  /** A file picked by hand from a torrent's files: that file plays, whatever episode was asked for. */
  fileChosen?: boolean | undefined;
  /** Where the person's own server (Jellyfin, Plex) says they stopped (seconds), used when Orbit's own history has nothing. */
  resume?: number | undefined;
  /** When that server says it was last played (ms), if it says. */
  resumeAt?: number | undefined;
  /** Not a first choice for automatic picks (uncached, or outside the autoplay limits; see lib/autoplay.ts). */
  autoplay?: AutoplayGate | undefined;
  /** Subtitles the addon shipped with this stream, offered with the subtitle addons'. */
  subtitles?: StreamSubtitles | undefined;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Upload limit, matching the Rust side. */
export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const SUBTITLE_TYPES = '.srt,.vtt,.ass,.ssa,.sub,.txt';
/** A search box appears once the language list gets long. */
const SEARCH_FROM = 8;

/** One selectable row: label, optional detail, a check when selected. */
function row(options: { label: string; detail?: string; note?: string; chip?: string | undefined; selected?: boolean; focusId: string; lead?: IconName; trail?: string; expanded?: boolean }, onPick: () => void): HTMLElement {
  const attrs: Record<string, string | boolean> = { class: `panel-row${options.selected ? ' selected' : ''}`, 'data-focus-id': options.focusId };
  if (options.expanded !== undefined) attrs['aria-expanded'] = String(options.expanded);
  else attrs['aria-pressed'] = String(!!options.selected);
  const button = h(
    'button',
    attrs,
    options.lead ? icon(options.lead) : '',
    h(
      'span',
      { class: 'panel-row-text' },
      h('span', { class: 'panel-row-label' }, options.label, options.chip ? h('span', { class: 'panel-row-chip' }, options.chip) : ''),
      options.detail ? h('span', { class: 'panel-row-detail' }, options.detail) : '',
      options.note ? h('span', { class: 'panel-row-note' }, options.note) : '',
    ),
    options.trail ? h('span', { class: 'panel-row-trail' }, options.trail) : '',
    options.selected ? icon('check') : '',
  );
  button.addEventListener('click', onPick);
  return button;
}

const section = (title: string, ...children: (Node | string)[]) => h('section', { class: 'panel-section' }, h('h3', { class: 'panel-heading' }, title), ...children);

export interface TracksPanel {
  tracks: readonly TrackInfo[];
  groups: readonly SubtitleGroup[];
  expanded: string | null;
  filter: string;
  /** Addons still being asked for subtitles. */
  loadingOffers: boolean;
  offerAddons: readonly string[];
  failedAddons: readonly string[];
  onAudio(id: number): void;
  onSubtitle(option: SubtitleOption | null): void;
  onExpand(key: string | null): void;
  onFilter(text: string): void;
  onUpload(file: File): void;
  /** Paste subtitles…: opens the box to paste SRT or WebVTT text into. */
  onPaste(): void;
  /** "Try another subtitle", when there's another offer in the language showing (its detail names the language). */
  another?: { detail: string; onTry(): void };
  /** Seconds; positive shows them later. */
  delays: { audio: number; sub: number };
  onDelay(kind: 'audio' | 'sub', seconds: number): void;
  /** A second subtitle track shown at the top (e.g. for language learning); null for none. */
  onSecondary(id: number | null): void;
  /** Offered when audio or subtitles were picked by hand for this title (see track-memory.ts). */
  forget?: { label: string; onForget(): void };
  /** "Sync automatically", for an added subtitle that's showing (see subtitle-sync.ts); while it runs, the row cancels it. */
  sync?: { label: string; detail: string; onToggle(): void };
  /** "Translate to <language>…" (Settings → Subtitles → AI subtitle translation, see subtitle-translate.ts); while it runs, the row cancels it. */
  translate?: { label: string; detail: string; onToggle(): void };
  /** Where subtitles sit, remembered for every video: `lift` is how far above the bottom (% of the picture). */
  position: { lift: number; keepBottom: boolean; onLift(lift: number): void; onKeepBottom(on: boolean): void };
  /** How subtitles look (the same saved style as Settings → Subtitles), applied as it changes; and Fix ALL-CAPS. */
  look: { style: SubtitleStyle; onStyle(patch: Partial<SubtitleStyle>): void; caps: boolean; onCaps(on: boolean): void };
  /** Says something briefly (a typed value that can't be used). */
  say(message: string): void;
  /** Where the sound goes (see audio-device.ts); absent where mpv doesn't play (Android). */
  output?: { choices: readonly { name: string; label: string }[]; wanted: string; missing: boolean; onPick(name: string): void };
}

/** How far one press of − or + (or G/H) moves audio or subtitle timing. */
export const DELAY_STEP = 0.1;
/** Audio and subtitle timing go no further than this either way (as Rust accepts). */
export const DELAY_LIMIT = 30;

/** "+0.3 s", "−1.2 s", "0.0 s". */
export const formatDelay = (seconds: number) => t('player.delay.seconds', { value: `${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${formatNumber(Math.abs(seconds), 1)}` });

/**
 * The subtitle position: a slider (0 is the bottom), Reset to bottom, and
 * "Keep at the bottom" for plain subtitles that place lines themselves.
 * Shown whether or not subtitles are on: it's a setting for every video, and
 * picking it before turning them on is fine.
 */
function positionControls(p: TracksPanel['position']): HTMLElement {
  const slider = createSlider({
    label: t('subs.player.height'),
    min: 0,
    max: POSITION_BOTTOM - POSITION_HIGHEST,
    value: p.lift,
    format: (lift) => (lift === 0 ? t('player.subtitle-style.bottom') : t('subs.player.raised', { value: formatNumber(lift) })),
    focusId: 'sub-position',
    onInput: p.onLift,
  });
  const reset = h('button', { class: 'chip', 'data-focus-id': 'sub-position-reset' }, t('subs.player.reset'));
  reset.addEventListener('click', () => {
    slider.setValue(0);
    p.onLift(0);
  });
  const keep = createSwitch(t('subs.player.keep-bottom'), p.keepBottom, p.onKeepBottom);
  keep.classList.add('wide');
  keep.dataset.focusId = 'sub-keep-bottom';
  return h('div', { class: 'subtitle-position' }, slider, h('div', { class: 'chips' }, reset), keep, h('p', { class: 'panel-note' }, t('subs.player.keep-bottom-hint')));
}

/** A small group of toggle chips; `current` is the pressed one. */
function chips<T extends string | number>(label: string, focus: string, options: readonly (readonly [T, string])[], current: T, onPick: (value: T) => void): HTMLElement {
  return h(
    'div',
    { class: 'chips panel-chips', role: 'group', 'aria-label': label },
    ...options.map(([value, text]) => {
      const chip = h('button', { class: 'chip', 'aria-pressed': String(value === current), 'data-focus-id': `${focus}-${value}` }, text);
      chip.addEventListener('click', () => onPick(value));
      return chip;
    }),
  );
}

const STEPPER_TEXT = {
  sub: { label: 'player.timing.subtitle', earlier: 'player.timing.subtitle-earlier', later: 'player.timing.subtitle-later', reset: 'player.timing.subtitle-reset' },
  audio: { label: 'player.timing.audio', earlier: 'player.timing.audio-earlier', later: 'player.timing.audio-later', reset: 'player.timing.audio-reset' },
} as const;

/**
 * A timing's value, which can be typed: activating it (Enter, a click) turns
 * it into a text field, editing at once, as asked; Enter applies the number
 * (kept within ±30 s), Escape or leaving puts the value back unchanged.
 */
function typedValue(kind: 'audio' | 'sub', focusId: string, value: number, onChange: (seconds: number) => void, say: (message: string) => void): HTMLElement {
  const name = t(STEPPER_TEXT[kind].label);
  const shown = formatDelay(value);
  const button = h('button', { class: 'panel-stepper-value', 'data-focus-id': focusId, 'aria-label': t('pstream.timing.type', { name, value: shown }), title: t('pstream.timing.field', { name }) }, shown);
  button.addEventListener('click', () => {
    let settled = false;
    const putBack = (refocus: boolean) => {
      if (settled) return;
      settled = true;
      field.replaceWith(button);
      if (refocus) button.focus({ preventScroll: true });
    };
    const field = createTextField({
      label: t('pstream.timing.field', { name }),
      className: 'panel-stepper-field',
      onSubmit: (typed) => {
        const seconds = parseSeconds(typed);
        if (seconds === null) return say(t('pstream.timing.invalid'));
        settled = true;
        // Redraws the view; focus finds the value again by its id.
        onChange(Math.max(-DELAY_LIMIT, Math.min(DELAY_LIMIT, Math.round(seconds * 10) / 10)));
      },
    });
    field.value = formatNumber(value, 1);
    field.dataset.focusId = focusId;
    // Escape is the field's while it's being typed in (see keys.ts), not the panel's Back.
    field.dataset.adjusting = 'true';
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      putBack(true);
    });
    field.addEventListener('blur', () => putBack(false));
    button.replaceWith(field);
    beginEditing(field);
    field.select();
  });
  return button;
}

/** − value + for audio or subtitle timing, with a reset; `labelled` false under a heading that already names it. */
function stepper(kind: 'audio' | 'sub', focus: string, value: number, onChange: (seconds: number) => void, say: (message: string) => void, labelled = true): HTMLElement {
  const text = STEPPER_TEXT[kind];
  const button = (text: string, aria: string, next: number, id: string) => {
    const b = h('button', { class: 'chip', 'aria-label': aria, 'data-focus-id': `${focus}-${id}` }, text);
    b.addEventListener('click', () => onChange(Math.round(next * 10) / 10));
    return b;
  };
  return h(
    'div',
    { class: 'panel-stepper' },
    labelled ? h('span', { class: 'panel-stepper-label' }, t(text.label)) : '',
    button('−', t(text.earlier), value - DELAY_STEP, 'minus'),
    typedValue(kind, `${focus}-value`, value, onChange, say),
    button('+', t(text.later), value + DELAY_STEP, 'plus'),
    button(t('player.timing.reset'), t(text.reset), 0, 'reset'),
  );
}

/** The big subtitle timing jumps, both ways. */
export const SUBTITLE_JUMPS = [0.5, 3] as const;

/**
 * Subtitle timing named by what the viewer noticed rather than by direction:
 * "Heard it first" means the line came late, so subtitles move earlier;
 * "Saw it first" means it came early, so they move later. The fine − / +
 * stepper stays below for small corrections.
 */
function subtitleTiming(value: number, onChange: (seconds: number) => void): HTMLElement {
  const side = (heading: string, hint: string, sign: -1 | 1, id: string) =>
    h(
      'div',
      { class: 'timing-side', role: 'group', 'aria-label': heading },
      h('span', { class: 'timing-side-heading' }, heading),
      h('span', { class: 'timing-side-hint' }, hint),
      h(
        'div',
        { class: 'timing-side-jumps' },
        ...SUBTITLE_JUMPS.map((jump) => {
          const b = h('button', { class: 'chip', 'data-focus-id': `timing-${id}-${jump}`, 'aria-label': t(sign < 0 ? 'playerplus.timing.earlier-by' : 'playerplus.timing.later-by', { value: formatNumber(jump, 1) }) }, formatDelay(sign * jump));
          b.addEventListener('click', () => onChange(Math.round((value + sign * jump) * 10) / 10));
          return b;
        }),
      ),
    );
  return h(
    'div',
    { class: 'timing-perception' },
    side(t('playerplus.timing.heard-first'), t('playerplus.timing.heard-first-hint'), -1, 'heard'),
    side(t('playerplus.timing.saw-first'), t('playerplus.timing.saw-first-hint'), 1, 'saw'),
  );
}

/** Every audio track, the one playing checked; then the output device. */
export function audioView(p: TracksPanel): HTMLElement[] {
  const audio = p.tracks.filter((t) => t.kind === 'audio');
  const tracks = !audio.length
    ? [h('p', { class: 'panel-note' }, t('playerplus.hub.no-audio'))]
    : [
        h(
          'div',
          { class: 'panel-list' },
          ...audio.map((t) => {
            const { label, detail } = audioLabel(t);
            return row({ label, detail, selected: t.selected, focusId: `audio-${t.id}` }, () => p.onAudio(t.id));
          }),
        ),
        ...(p.forget ? [row({ label: p.forget.label, detail: t('watching.tracks.forget-detail'), focusId: 'tracks-forget' }, p.forget.onForget)] : []),
      ];
  const out = p.output;
  if (!out) return tracks;
  const devices = h('div', { class: 'panel-list', role: 'group', 'aria-label': t('audiodevice.title') }, ...out.choices.map((c) => row({ label: c.label, selected: c.name === out.wanted, focusId: `output-${c.name}` }, () => out.onPick(c.name))));
  return [...tracks, section(t('audiodevice.title'), devices, ...(out.missing ? [h('p', { class: 'panel-note' }, t('audiodevice.missing'))] : []))];
}

/**
 * The languages the Subtitles view lists for what's typed in its search. The
 * search only shows with many languages; with fewer (another file, offers
 * still on their way) what was typed earlier filters nothing, as it couldn't be cleared.
 */
export function shownGroups(groups: readonly SubtitleGroup[], typed: string): readonly SubtitleGroup[] {
  const filter = typed.trim().toLowerCase();
  if (!filter || groups.length <= SEARCH_FROM) return groups;
  return groups.filter((g) => g.name.toLowerCase().includes(filter));
}

/** Subtitles: off, each language (with its choices), uploading a file, and a second line. */
export function subtitlesView(p: TracksPanel): HTMLElement[] {
  const parts: HTMLElement[] = [];
  const subtitleSelected = p.groups.some((g) => g.selected);
  const rows: HTMLElement[] = [row({ label: t('player.tracks.off'), selected: !subtitleSelected, focusId: 'sub-off' }, () => p.onSubtitle(null))];
  if (p.another) rows.push(row({ label: t('playertools.subs.try-another'), detail: p.another.detail, focusId: 'sub-another', lead: 'swap' }, p.another.onTry));

  if (p.groups.length > SEARCH_FROM) {
    const search = createTextField({ label: t('player.tracks.search'), placeholder: t('player.tracks.search'), className: 'panel-search', onSubmit: () => {} });
    search.value = p.filter;
    search.dataset.focusId = 'sub-search';
    search.addEventListener('input', () => p.onFilter(search.value));
    rows.push(search);
  }

  for (const group of shownGroups(p.groups, p.filter)) {
    const open = p.expanded === group.key;
    rows.push(
      row({ label: group.name, selected: group.selected && !open, focusId: `lang-${group.key}`, trail: String(group.options.length), expanded: open }, () =>
        p.onExpand(open ? null : group.key),
      ),
    );
    if (open) {
      rows.push(
        h(
          'div',
          { class: 'panel-options' },
          ...group.options.map((option, i) =>
            row(
              { label: option.label, detail: option.detail, chip: option.sdh ? t('pstream.subs.sdh') : undefined, selected: option.kind === 'track' && option.track.selected, focusId: `sub-${group.key}-${i}` },
              () => p.onSubtitle(option),
            ),
          ),
        ),
      );
    }
  }

  const file = h('input', { type: 'file', accept: SUBTITLE_TYPES, hidden: true, tabindex: '-1' });
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) p.onUpload(chosen);
    file.value = '';
  });
  rows.push(row({ label: t('player.tracks.upload'), detail: t('player.tracks.upload-detail'), focusId: 'sub-upload', lead: 'upload' }, () => file.click()), file);
  rows.push(row({ label: t('playertools.paste.action'), detail: t('playertools.paste.detail'), focusId: 'sub-paste', lead: 'pencil' }, p.onPaste));
  if (p.translate) rows.push(row({ label: p.translate.label, detail: p.translate.detail, focusId: 'sub-translate', lead: 'globe' }, p.translate.onToggle));

  const embedded = p.tracks.filter((t) => t.kind === 'sub' && !t.external).length;
  const note = [
    tn('player.tracks.in-file', embedded),
    p.loadingOffers ? t('player.tracks.asking') : p.offerAddons.length ? t('player.tracks.more-from', { addons: p.offerAddons.join(', ') }) : t('player.tracks.no-addons'),
    p.failedAddons.length ? t('player.tracks.no-answer', { addons: p.failedAddons.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  parts.push(h('div', { class: 'panel-list' }, ...rows), h('p', { class: 'panel-note' }, note));
  if (p.forget) parts.push(row({ label: p.forget.label, detail: t('watching.tracks.forget-detail'), focusId: 'tracks-forget' }, p.forget.onForget));

  // A second line at the top, from tracks the file has (or added addon subtitles).
  const subs = p.tracks.filter((t) => t.kind === 'sub' && !t.selected);
  if (subs.length) {
    const second = p.tracks.some((t) => t.secondary);
    parts.push(
      section(
        t('player.tracks.second'),
        row({ label: t('player.tracks.off'), selected: !second, focusId: 'sub2-off' }, () => p.onSecondary(null)),
        ...subs.map((t) =>
          row({ label: languageName(languageKey(t.lang)), ...(t.title ? { detail: t.title } : {}), selected: t.secondary, focusId: `sub2-${t.id}` }, () => p.onSecondary(t.id)),
        ),
      ),
    );
  }
  return parts;
}

/** While a panel's field is being typed in, Escape stops the typing (keys.ts leaves it to the field) rather than going Back. */
function escapeStopsTyping(field: HTMLInputElement): void {
  const sync = () => {
    if (field.readOnly) delete field.dataset.adjusting;
    else field.dataset.adjusting = 'true';
  };
  for (const type of ['keydown', 'pointerdown', 'blur'] as const) field.addEventListener(type, () => queueMicrotask(sync));
}

/**
 * The text colours, then "Custom…", which opens a colour code field (a hex
 * code like the accent's, checked before it's used; reaching the field only
 * focuses it, Enter starts typing). A colour that isn't a preset keeps it open.
 */
function colourChoices(current: string, onColour: (hex: string) => void, say: (message: string) => void): HTMLElement {
  const custom = !SUBTITLE_COLORS.some(([hex]) => hex === current);
  const field = createTextField({
    label: t('pstream.style.hex'),
    placeholder: '#ffcc00',
    className: 'hex-field panel-hex',
    onSubmit: (typed) => {
      const hex = parseHex(typed);
      if (hex) onColour(hex);
      else say(t('settings.accent.hex-invalid'));
    },
  });
  field.maxLength = 7;
  field.value = current;
  field.dataset.focusId = 'style-hex';
  // Starting to type replaces the code shown (it's at its length limit), as the timing field does.
  let wasReadOnly = false;
  field.addEventListener('keydown', (event) => event.key === 'Enter' && (wasReadOnly = field.readOnly), { capture: true });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && wasReadOnly && !field.readOnly) field.select();
  });
  escapeStopsTyping(field);
  field.hidden = !custom;
  const customChip = h('button', { class: 'chip', 'aria-pressed': String(custom), 'aria-expanded': String(custom), 'data-focus-id': 'style-colour-custom' }, t('pstream.style.custom'));
  customChip.addEventListener('click', () => {
    field.hidden = false;
    customChip.setAttribute('aria-expanded', 'true');
    field.focus({ preventScroll: false });
  });
  return h(
    'div',
    { class: 'chips panel-chips', role: 'group', 'aria-label': t('settings.subtitles.colour') },
    ...SUBTITLE_COLORS.map(([hex, name]) => {
      const chip = h('button', { class: 'chip colour-chip', 'aria-pressed': String(hex === current), 'data-focus-id': `style-colour-${hex}` }, h('span', { class: 'colour-dot', 'aria-hidden': 'true' }), name);
      chip.style.setProperty('--swatch', hex);
      chip.addEventListener('click', () => onColour(hex));
      return chip;
    }),
    customChip,
    field,
  );
}

/**
 * Subtitle style in the player: where they sit, then size, colour,
 * background, outline, bold and Fix ALL-CAPS. The same saved style as
 * Settings → Subtitles; mpv draws them, so each change shows at once.
 */
export function subtitleStyleView(p: TracksPanel): HTMLElement[] {
  const { style } = p.look;
  const sample = h('div', { class: 'subtitle-preview' }, h('span', { class: 'subtitle-sample' }, t('trybox.subtitle.sample')));
  let previewStyle = { ...style };
  applySubtitleCss(sample, previewStyle);
  const onStyle = (patch: Partial<SubtitleStyle>) => {
    previewStyle = { ...previewStyle, ...patch };
    applySubtitleCss(sample, previewStyle);
    p.look.onStyle(patch);
  };
  const onLift = (lift: number) => {
    previewStyle = { ...previewStyle, position: POSITION_BOTTOM - lift };
    applySubtitleCss(sample, previewStyle);
    p.position.onLift(lift);
  };
  const size = createSlider({
    label: t('settings.subtitles.size-label'),
    min: SIZE_MIN,
    max: SIZE_MAX,
    step: SIZE_STEP,
    value: style.size,
    // Relative to mpv's default, which reads as 100%, as in Settings.
    format: (v) => new Intl.NumberFormat(locale(), { style: 'percent' }).format(Math.round((v / SIZE_DEFAULT) * 100) / 100),
    focusId: 'style-size',
    onInput: (v) => onStyle({ size: v }),
  });
  const bold = createSwitch(t('settings.subtitles.bold'), style.bold, (on) => onStyle({ bold: on }));
  bold.classList.add('wide');
  bold.dataset.focusId = 'style-bold';
  const caps = createSwitch(t('playertools.caps.setting'), p.look.caps, p.look.onCaps);
  caps.classList.add('wide');
  caps.dataset.focusId = 'style-caps';
  const backgrounds = [
    ['none', t('settings.subtitles.background-none')],
    ['shadow', t('settings.subtitles.background-shadow')],
    ['box', t('settings.subtitles.background-box')],
  ] as const;
  return [
    sample,
    section(t('trybox.subtitle.font'), chips(t('trybox.subtitle.font'), 'style-font', SUBTITLE_FONTS.map(([id, label]) => [id, label] as const), style.font, (font) => onStyle({ font }))),
    section(t('pstream.style.position'), positionControls({ ...p.position, onLift })),
    section(
      t('pstream.style.title'),
      h('div', { class: 'subtitle-look' }, size),
      h('span', { class: 'panel-label' }, t('settings.subtitles.colour')),
      colourChoices(style.color, (color) => onStyle({ color }), p.say),
      h('span', { class: 'panel-label' }, t('settings.subtitles.background')),
      chips(t('settings.subtitles.background-label'), 'style-background', backgrounds, style.background, (background) => onStyle({ background })),
      h('span', { class: 'panel-label' }, t('settings.subtitles.outline')),
      chips(t('settings.subtitles.outline-label'), 'style-outline', SUBTITLE_OUTLINES, style.outline, (outline) => onStyle({ outline })),
      h('div', { class: 'subtitle-look' }, bold, caps),
      h('p', { class: 'panel-note' }, t('pstream.style.caps-note')),
    ),
    h('p', { class: 'panel-note' }, t('pstream.style.more')),
  ];
}

/** Subtitle and audio timing, with "Sync automatically" for an added subtitle. */
export function timingView(p: TracksPanel): HTMLElement[] {
  const note = timingNote();
  return [
    p.sync ? row({ label: p.sync.label, detail: p.sync.detail, focusId: 'sub-sync', lead: 'subtitles' }, p.sync.onToggle) : '',
    section(t('player.timing.subtitle'), subtitleTiming(p.delays.sub, (s) => p.onDelay('sub', s)), stepper('sub', 'delay-sub', p.delays.sub, (s) => p.onDelay('sub', s), p.say, false)),
    stepper('audio', 'delay-audio', p.delays.audio, (s) => p.onDelay('audio', s), p.say),
    note ? h('p', { class: 'panel-note' }, note) : '',
  ].filter((el): el is HTMLElement => el !== '');
}

/** Sleep timer choices: minutes, or the end of what's playing. */
export const SLEEP_CHOICES = [
  ['off', t('player.sleep.off')],
  ['15', t('player.sleep.minutes', { minutes: 15 })],
  ['30', t('player.sleep.minutes', { minutes: 30 })],
  ['45', t('player.sleep.minutes', { minutes: 45 })],
  ['60', t('player.sleep.hour')],
  ['end', t('player.sleep.end')],
] as const;
export type SleepChoice = (typeof SLEEP_CHOICES)[number][0];

export const ASPECTS = [
  ['no', t('player.picture.auto')],
  ['16:9', '16:9'],
  ['4:3', '4:3'],
  ['21:9', '21:9'],
  ['2.39:1', '2.39:1'],
] as const;
export type Aspect = (typeof ASPECTS)[number][0];
export const FITS = [
  ['fit', t('player.picture.fit')],
  ['fill', t('player.picture.fill')],
  ['stretch', t('player.picture.stretch')],
] as const;
export type Fit = (typeof FITS)[number][0];

/** A saved fit, or 'fit' (the whole picture, with bars). */
export const parseFit = (value: unknown): Fit => FITS.find(([f]) => f === value)?.[0] ?? 'fit';

/** Each picture quality preset's name (Settings → Video). */
export const QUALITY_NAMES: Record<PictureQuality, MessageKey> = {
  fast: 'player.picture.quality-fast',
  balanced: 'player.picture.quality-balanced',
  high: 'player.picture.quality-high',
};

export interface PictureAndSound {
  aspect: Aspect;
  fit: Fit;
  picture: Picture;
  /** Settings → Video → Picture quality, summed up under the adjustments. */
  quality: PictureQuality;
  /** Night mode or a sound preset (see sound.ts). */
  sound: SoundMode;
  /** The sound goes to a receiver undecoded: night mode can't apply to it. */
  passthrough: boolean;
  onAspect(aspect: Aspect): void;
  onFit(fit: Fit): void;
  onPicture(picture: Picture): void;
  onSound(mode: SoundMode): void;
  boost?: { level: VolumeBoostLevel; onPick(level: VolumeBoostLevel): void };
}

/**
 * The playback speeds: pills for the usual ones, and Custom, which shows a
 * − value + stepper (0.25–3× in 0.05 steps; see speed.ts). A speed that
 * isn't a pill (set with the stepper) marks Custom and keeps it open, as
 * does stepping onto a pill's speed (`stepped`), so + and − keep working.
 */
export function speedView(current: number, onPick: (speed: number, stepped?: boolean) => void, note: string, custom: { open: boolean; onOpen(): void }): HTMLElement[] {
  const customOn = custom.open || !isPreset(current);
  const customChip = h('button', { class: 'chip', 'aria-pressed': String(customOn), 'aria-expanded': String(customOn), 'data-focus-id': 'speed-custom' }, t('playertools.speed.custom'));
  customChip.addEventListener('click', custom.onOpen);
  const step = (direction: 1 | -1, text: string, label: string, id: string) => {
    const next = stepSpeed(current, direction);
    const b = h('button', { class: 'chip', 'aria-label': label, 'data-focus-id': `speed-${id}` }, text);
    b.addEventListener('click', () => onPick(next, true));
    return b;
  };
  return [
    h(
      'div',
      { class: 'chips panel-chips', role: 'group', 'aria-label': t('player.speed.label') },
      ...SPEED_PRESETS.map((speed) => {
        const on = !custom.open && Math.abs(speed - current) < 0.01;
        const chip = h('button', { class: 'chip', 'aria-pressed': String(on), 'data-focus-id': `speed-${speed}` }, speed === 1 ? t('player.speed.normal') : speedLabel(speed));
        chip.addEventListener('click', () => onPick(speed));
        return chip;
      }),
      customChip,
    ),
    ...(customOn
      ? [
          h(
            'div',
            { class: 'panel-stepper', role: 'group', 'aria-label': t('playertools.speed.custom-label') },
            step(-1, '−', t('playertools.speed.slower'), 'slower'),
            h('span', { class: 'panel-stepper-value', 'aria-live': 'polite' }, speedLabel(current)),
            step(1, '+', t('playertools.speed.faster'), 'faster'),
          ),
        ]
      : []),
    ...(note ? [h('p', { class: 'panel-note' }, note)] : []),
  ];
}

/** The sleep timer's choices, and what it will do. */
export function sleepView(sleep: { choice: SleepChoice; note: string; onPick(choice: SleepChoice): void }): HTMLElement[] {
  return [
    h(
      'div',
      { class: 'chips panel-chips', role: 'group', 'aria-label': t('player.sleep.label') },
      ...SLEEP_CHOICES.map(([value, label]) => {
        const chip = h('button', { class: 'chip', 'aria-pressed': String(sleep.choice === value), 'data-focus-id': `sleep-${value}` }, label);
        chip.addEventListener('click', () => sleep.onPick(value));
        return chip;
      }),
    ),
    ...(sleep.note ? [h('p', { class: 'panel-note' }, sleep.note)] : []),
  ];
}

/** The picture's shape and its adjustments. */
export function pictureView(more: PictureAndSound): HTMLElement[] {
  return [
    h('span', { class: 'panel-label' }, t('player.picture.shape')),
    chips(t('player.picture.aspect'), 'aspect', ASPECTS, more.aspect, more.onAspect),
    h('span', { class: 'panel-label' }, withKey(t('player.picture.fill-label'), 'player.fit')),
    chips(t('player.picture.fill-group'), 'fit', FITS, more.fit, more.onFit),
    h('p', { class: 'panel-note' }, t('player.picture.fill-note')),
    h('span', { class: 'panel-label' }, t('player.picture.look')),
    pictureControls(more.picture, more.onPicture, 'look'),
    h('p', { class: 'panel-note' }, t('player.picture.quality-summary', { preset: t(QUALITY_NAMES[more.quality]) })),
  ];
}

/** Night mode and the sound presets: one at a time. */
export function soundView(more: PictureAndSound): HTMLElement[] {
  const rows = SOUND_MODES.map((mode) =>
    row({ label: t(SOUND_NAMES[mode]), detail: t(SOUND_HINTS[mode]), selected: more.sound === mode, focusId: `sound-${mode}` }, () => more.onSound(mode)),
  );
  if (more.passthrough) for (const r of rows) (r as HTMLButtonElement).disabled = true;
  const view = [
    h('div', { class: 'panel-list', role: 'group', 'aria-label': t('playerplus.hub.sound') }, ...rows),
    h('p', { class: 'panel-note' }, more.passthrough ? t('player.passthrough.note') : t('playerplus.sound.note')),
  ];
  if (!more.boost) return view;
  const levels = VOLUME_BOOST_LEVELS.map((level) => [level, level === 100 ? t('trybox.boost.off') : t('trybox.controls.percent', { percent: formatNumber(level) })] as const);
  const boost = chips(t('trybox.boost.title'), 'volume-boost', levels, more.boost.level, more.boost.onPick);
  if (more.passthrough) boost.querySelectorAll('button').forEach((button) => (button.disabled = true));
  const note = h('p', { class: 'panel-note' }, t(more.passthrough ? 'trybox.boost.passthrough' : 'trybox.boost.note'));
  return [...view, section(t('trybox.boost.title'), boost, note)];
}

/** The quiet tag on a source that failed lately for this movie or episode. */
const FAILURE_TEXT: Record<FailureReason | 'unknown', MessageKey> = {
  unknown: 'player.source.failure.unknown',
  failed: 'player.source.failure.failed',
  slow: 'player.source.failure.slow',
  stalled: 'player.source.failure.stalled',
  placeholder: 'player.source.failure.placeholder',
};

export interface SourcePanel {
  sources: readonly PlayableSource[];
  currentId: string;
  onPick(source: PlayableSource): void;
  /** The source playing is a torrent with several videos (a season pack), to pick one of. */
  files?: { count: number; onOpen(): void } | undefined;
  /** The addon the list is narrowed to (null for all; see source-filter.ts). */
  addon: string | null;
  onAddon(addon: string | null): void;
  /** Whether a source failed lately here, and how if known; null if it didn't. */
  failure(source: PlayableSource): { reason: FailureReason | undefined } | null;
}

export function sourcePanel(p: SourcePanel): HTMLElement[] {
  const groups = addonGroups(p.sources);
  const visible = fromAddon(p.sources, p.addon);
  const playing = p.sources.find((s) => s.id === p.currentId);
  const addonName = (addon: string) => addon || t('player.source.unnamed');
  const chip = (addon: string | null, focusId: string, name: string, count?: number) => {
    const b = h(
      'button',
      { class: 'chip', 'aria-pressed': String(p.addon === addon), 'data-focus-id': focusId, title: name, ...(count === undefined ? {} : { 'aria-label': tn('player.source.addon-sources', count, { name }) }) },
      h('span', { class: 'chip-name' }, name),
      count === undefined ? '' : h('span', { class: 'chip-count' }, count.toLocaleString(locale())),
    );
    b.addEventListener('click', () => p.onAddon(addon));
    return b;
  };
  return [
    p.files ? row({ label: t('player.files.title'), detail: tn('player.files.count', p.files.count), lead: 'list', focusId: 'source-files' }, p.files.onOpen) : '',
    offerAddonFilter(groups)
      ? h(
          'div',
          { class: 'chips panel-chips', role: 'group', 'aria-label': t('player.source.addons') },
          chip(null, 'source-addon-all', t('player.source.all-addons')),
          // The list doesn't change while the panel is open, so a chip's place is a stable id.
          ...groups.map((g, i) => chip(g.addon, `source-addon-${i}`, addonName(g.addon), g.count)),
        )
      : '',
    // The source playing stays findable when the filter hides it.
    playing && !visible.includes(playing) ? h('p', { class: 'panel-hidden-note' }, t('player.source.hidden', { addon: addonName(playing.addon), quality: playing.label })) : '',
    h(
      'div',
      { class: 'panel-list' },
      ...visible.map((s) => {
        // The row playing stays as it is, whatever happened to it before.
        const failed = s.id === p.currentId ? null : p.failure(s);
        return row(
          { label: `${s.label} · ${s.addon}`, detail: s.meta, ...(failed ? { note: t(FAILURE_TEXT[failed.reason ?? 'unknown']) } : {}), selected: s.id === p.currentId, focusId: `source-${s.id}` },
          () => p.onPick(s),
        );
      }),
    ),
    h('p', { class: 'panel-note' }, t('player.source.note')),
  ].filter((el): el is HTMLElement => el !== '');
}

/** A torrent's files: the picker, or a note while it loads (or why it can't). The panel's Back returns to the sources. */
export function filesPanel(content: HTMLElement | string): HTMLElement[] {
  return [typeof content === 'string' ? h('p', { class: 'panel-note' }, content) : content];
}

export function episodesPanel(options: {
  /** For the watched state of each episode (spoiler protection). */
  title: Title;
  seasons: readonly Season[];
  season: number;
  current: { season: number; number: number } | undefined;
  onSeason(n: number): void;
  onPick(season: number, episode: Episode): void;
}): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (options.seasons.length > 1) {
    parts.push(
      h(
        'div',
        { class: 'chips panel-chips', role: 'group', 'aria-label': t('player.episodes.season-group') },
        ...options.seasons.map((s) => {
          const chip = h('button', { class: 'chip', 'aria-pressed': String(s.number === options.season), 'data-focus-id': `season-${s.number}` }, s.number === 0 ? t('player.episodes.specials') : t('player.episodes.season', { number: String(s.number) }));
          chip.addEventListener('click', () => options.onSeason(s.number));
          return chip;
        }),
      ),
    );
  }
  const season = options.seasons.find((s) => s.number === options.season);
  parts.push(
    h(
      'div',
      { class: 'panel-list' },
      ...(season?.episodes ?? []).map((ep) => {
        const playing = options.current?.season === options.season && options.current.number === ep.number;
        const state = episodeState(options.title, options.season, ep);
        // Spoiler protection, as on the show's page; the episode playing is never hidden.
        const hide = playing ? hiddenFor('in-progress') : hiddenFor(state.kind);
        const thumb = h('span', { class: `episode-thumb${hide.thumbnail ? ' spoiler-art' : ''}` });
        if (ep.thumbnail) {
          const img = h('img', { src: ep.thumbnail, alt: '', loading: 'lazy', decoding: 'async' });
          img.addEventListener('error', () => img.remove(), { once: true });
          thumb.append(img);
        }
        // The one playing is marked as playing; its saved progress would lag behind.
        thumb.append(...watchedMarks(playing && state.kind === 'in-progress' ? { kind: 'unwatched' } : state));
        const number = playing ? t('player.episodes.playing', { number: String(ep.number) }) : ep.airs && !hide.airDate ? t('player.episodes.airs', { number: String(ep.number), date: ep.airs }) : t('player.episodes.episode', { number: String(ep.number) });
        const detail = state.kind === 'watched' ? `${number} · ${t('pstream.episodes.watched')}` : number;
        const button = h(
          'button',
          { class: `panel-row episode-row${playing ? ' selected' : ''}`, 'aria-current': playing ? 'true' : 'false', disabled: !!ep.airs, 'data-focus-id': `ep-${options.season}-${ep.number}` },
          thumb,
          h('span', { class: 'panel-row-text' }, h('span', { class: 'panel-row-detail' }, detail), h('span', { class: 'panel-row-label' }, episodeName(ep.number, ep.title, hide.title))),
        );
        button.addEventListener('click', () => options.onPick(options.season, ep));
        // Aired episodes get the favourite heart and the watched check beside them, each its own focus stop.
        if (ep.airs) return button;
        return h(
          'div',
          { class: 'episode-panel-item' },
          button,
          favouriteHeart(options.title, options.season, ep, { className: 'panel-fav', focusId: `fav-${options.season}-${ep.number}` }),
          watchedToggle(options.title, options.season, ep, state.kind === 'watched', { className: 'panel-watched', focusId: `watched-${options.season}-${ep.number}` }),
        );
      }),
    ),
  );
  return parts;
}

/** "S1 · E3 · Pilot", or a movie's year. */
export function queueDetail(item: QueueItem): string {
  if (!item.episode) return item.title.year ?? '';
  return [t('titles.common.episode-code', { season: item.episode.season, episode: item.episode.number }), item.episode.name].filter(Boolean).join(' · ');
}

/** What plays next, for the Next Up card and the Next button: "S2 · E1 · Title", or the queued title (and episode). */
/** `title`: the series playing, for the next episode's watched state (spoiler protection); without it the episode counts as unwatched. */
export function upNextName(next: UpNext, title?: Title): string {
  if (next.kind === 'episode') {
    const { season, episode } = next.episode;
    const hide = hiddenFor(title ? episodeState(title, season, episode).kind : 'up-next');
    return t('player.episode.short-title', { season: String(season), episode: String(episode.number), title: episodeName(episode.number, episode.title, hide.title) });
  }
  const detail = next.item.episode ? queueDetail(next.item) : '';
  return detail ? `${next.item.title.name} · ${detail}` : next.item.title.name;
}

/** The queue, in order: each item plays when picked, with move earlier, later and remove beside it. */
export function queuePanel(items: readonly QueueItem[], on: { play(item: QueueItem): void; move(item: QueueItem, step: -1 | 1): void; remove(item: QueueItem): void }): HTMLElement[] {
  if (!items.length) return [h('p', { class: 'panel-note' }, t('watching.queue.empty-panel'))];
  const small = (label: string, iconName: IconName, focusId: string, disabled: boolean, action: () => void) => {
    const b = h('button', { class: 'panel-icon-button', title: label, 'aria-label': label, 'data-focus-id': focusId, disabled }, icon(iconName));
    b.addEventListener('click', action);
    return b;
  };
  return [
    h(
      'div',
      { class: 'panel-list' },
      ...items.map((item, i) => {
        const name = item.title.name;
        return h(
          'div',
          { class: 'queue-row' },
          row({ label: name, detail: queueDetail(item), focusId: `queue-play-${item.id}`, lead: 'play' }, () => on.play(item)),
          small(t('watching.queue.move-earlier-name', { name }), 'chevronUp', `queue-up-${item.id}`, i === 0, () => on.move(item, -1)),
          small(t('watching.queue.move-later-name', { name }), 'chevronDown', `queue-down-${item.id}`, i === items.length - 1, () => on.move(item, 1)),
          small(t('watching.queue.remove-name', { name }), 'close', `queue-remove-${item.id}`, false, () => on.remove(item)),
        );
      }),
    ),
    h('p', { class: 'panel-note' }, t('watching.queue.panel-note')),
  ];
}

/**
 * The intro, recap, credits and preview (from the file, TheIntroDB or a
 * learned intro), then the file's chapters; the one playing is marked, and
 * picking one jumps to its start.
 */
export function chaptersView(p: { chapters: readonly Chapter[]; current: number; onPick(chapter: Chapter): void; segments: readonly Segment[]; duration: number; position: number | null; onSegment(segment: Segment): void }): HTMLElement[] {
  if (!p.chapters.length && !p.segments.length) return [h('p', { class: 'panel-note' }, t('player.chapters.none'))];
  const span = (s: Segment) => (runsToEnd(s, p.duration) ? t('pstream.chapters.to-end', { from: formatTime(s.start) }) : `${formatTime(s.start)} – ${formatTime(s.end)}`);
  const playing = (s: Segment) => p.position !== null && p.position >= s.start && p.position < s.end;
  const segments = h(
    'div',
    { class: 'panel-list' },
    ...p.segments.map((s) => row({ label: t(BAND_NAMES[s.kind]), trail: span(s), selected: playing(s), focusId: `segment-${s.kind}-${Math.round(s.start)}` }, () => p.onSegment(s))),
  );
  const chapters = h(
    'div',
    { class: 'panel-list' },
    ...p.chapters.map((chapter, i) => row({ label: chapterName(chapter, i), trail: formatTime(chapter.time), selected: i === p.current, focusId: `chapter-${i}` }, () => p.onPick(chapter))),
  );
  if (!p.segments.length) return [chapters];
  if (!p.chapters.length) return [section(t('pstream.chapters.segments'), segments)];
  return [section(t('pstream.chapters.segments'), segments), section(t('player.chapters.title'), chapters)];
}

/** `copy`: "Copy stream link", when the source has a link another app could open (see copy-link.ts); `focusId` lets Back return to it. */
export function infoPanel(entries: readonly [string, string][], copy?: { focusId: string; onCopy(): void }, pin?: { on: boolean; change(on: boolean): void }): HTMLElement[] {
  const pinned = pin ? createSwitch(t('trybox.info.pin'), pin.on, pin.change) : null;
  if (pinned) { pinned.dataset.focusId = 'info-pin'; pinned.classList.add('wide'); }
  const pinRow = pinned ? [pinned] : [];
  const copyRow = copy ? [row({ label: t('player.copy-link.action'), detail: t('player.copy-link.detail'), lead: 'link', focusId: copy.focusId }, copy.onCopy)] : [];
  if (!entries.length) return [...pinRow, h('p', { class: 'panel-note' }, t('player.info.empty')), ...copyRow];
  return [...pinRow, h('dl', { class: 'info-list' }, ...entries.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), ...copyRow];
}

/** Asked before the first copy of a link that may hold an account key (see copy-link.ts). */
export function copyLinkView(p: { onCopy(): void; onCancel(): void }): HTMLElement[] {
  const cancel = row({ label: t('player.copy-link.cancel'), lead: 'back', focusId: 'copy-link-cancel' }, p.onCancel);
  // Focus starts on Cancel, so an Enter pressed out of habit doesn't copy a link that may hold a key.
  cancel.dataset.defaultFocus = '';
  return [
    h('p', { class: 'panel-note' }, t('player.copy-link.warning')),
    h(
      'div',
      { class: 'panel-list' },
      row({ label: t('player.copy-link.confirm'), detail: t('player.copy-link.once'), lead: 'link', focusId: 'copy-link-confirm' }, p.onCopy),
      cancel,
    ),
  ];
}

/** Uses the bar behind the panel as a live preview, with existing navigation semantics. */
export function controlsSizeView(layout: PlayerLayout, onPick: (scale: number) => void): HTMLElement[] {
  const scale = layout.scale ?? SIZE_SCALES[layout.size];
  const pick = (value: number) => {
    slider.setValue(value * 100);
    presets.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.focusId === `controls-size-${value}`)));
    onPick(value);
  };
  const sizes = [
    [0.85, t('trybox.controls.small')],
    [1, t('trybox.controls.medium')],
    [1.2, t('trybox.controls.large')],
  ] as const;
  const presets = chips(t('trybox.controls.title'), 'controls-size', sizes, scale, pick);
  const slider = createSlider({
    label: t('trybox.controls.title'),
    min: 70,
    max: 140,
    step: 5,
    value: scale * 100,
    format: (percent) => t('trybox.controls.percent', { percent: formatNumber(percent) }),
    focusId: 'controls-scale',
    onInput: (percent) => pick(percent / 100),
  });
  return [presets, slider];
}
