/**
 * Settings → Player: how it looks (the layout as preset cards with a
 * miniature of each, the switches on top, a live preview beside them, the
 * episodes list, and a link to Theme Studio for the seek bar), then how it
 * behaves (how far a jump goes, the volume boost, its keys, how its window
 * behaves, seek bar previews). Layout changes apply at once to a player
 * that's open (see player/layout.ts).
 */
import { createSwitch } from '../../components/switch';
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { applyLayoutAttributes, BACKGROUNDS, choosePreset, DEFAULT_LAYOUT, layoutChanged, loadPlayerLayout, PLAYER_LAYOUT_KEY, PRESETS, SIZES, TIMELINES, watchPlayerLayout, type PlayerLayout, type Preset } from '../player/layout';
import { DOUBLE_CLICK_SEEK_KEY, HOLD_BOOST_KEY, NUMBER_JUMP_KEY, parseSeekStep, SEEK_STEP_KEY, SEEK_STEPS, VOLUME_BOOST_KEY } from '../player/player-settings';
import { EPISODES_DOCKED_KEY } from '../player/episode-dock';
import { GRAYSCALE_PAUSE_KEY } from '../player/grayscale-pause';
import { PLAYBACK_SETTINGS } from '../player/next-up';
import { parseVolumePopupPosition, VOLUME_POPUP_KEY, VOLUME_POPUP_POSITION_KEY, type VolumePopupPosition } from '../player/volume-popup';
import { PREVIEWS_KEY } from '../player/previews';
import { parseRewindCache, REWIND_CACHE_PREFIX, type RewindPreset } from '../player/rewind-cache';
import { profileSetting } from '../../library/profiles';
import { isAndroid } from '../../lib/platform';
import { seekBarLink } from './appearance';
import { playerColourRow } from './player-colour';
import { onSettingsPage, showDependents } from './dependent-rows';
import { compactRows } from './compact';
import { chapter, choices, row, save } from './playback';
import './player-layout.css';

export const PRESET_NAMES: Record<Preset, string> = {
  orbit: t('playerlook.preset.orbit'),
  minimal: t('playerlook.preset.minimal'),
  streaming: t('playerlook.preset.streaming'),
  theater: t('playerlook.preset.theater'),
  cinema: t('playerlook.preset.cinema'),
  compact: t('playerlook.preset.compact'),
  floating: t('playerlook.preset.floating'),
  tv: t('playerlook.preset.tv'),
  arc: t('orbitlook.player'),
};

const PRESET_HINTS: Record<Preset, string> = {
  orbit: t('playerlook.preset.orbit-hint'),
  minimal: t('playerlook.preset.minimal-hint'),
  streaming: t('playerlook.preset.streaming-hint'),
  theater: t('playerlook.preset.theater-hint'),
  cinema: t('playerlook.preset.cinema-hint'),
  compact: t('playerlook.preset.compact-hint'),
  floating: t('playerlook.preset.floating-hint'),
  tv: t('playerlook.preset.tv-hint'),
  arc: t('orbitlook.player-hint'),
};

const SIZE_NAMES = { compact: t('playerlook.size.compact'), standard: t('playerlook.size.standard'), large: t('playerlook.size.large') };
const BACKGROUND_NAMES = { none: t('playerlook.background.none'), gradient: t('playerlook.background.gradient'), blur: t('playerlook.background.blur') };
const TIMELINE_NAMES = { line: t('playerlook.timeline.line'), accent: t('playerlook.timeline.accent'), chapters: t('playerlook.timeline.chapters') };

const SWITCHES: readonly { key: 'title' | 'badges' | 'next' | 'chapters' | 'clock'; label: MessageKey; hint: MessageKey }[] = [
  { key: 'title', label: 'playerlook.show-title', hint: 'playerlook.show-title-hint' },
  { key: 'badges', label: 'playerlook.show-badges', hint: 'playerlook.show-badges-hint' },
  { key: 'next', label: 'playerlook.show-next', hint: 'playerlook.show-next-hint' },
  { key: 'chapters', label: 'playerlook.show-chapters', hint: 'playerlook.show-chapters-hint' },
  { key: 'clock', label: 'playerlook.show-clock', hint: 'playerlook.show-clock-hint' },
];

const part = (name: string, ...children: Node[]) => h('span', { class: `pl-${name}` }, ...children);
const parts = (name: string, count: number) => Array.from({ length: count }, () => part(name));

/** A small drawing of the player in `layout`, styled by the same data attributes as the real one. */
function miniature(layout: PlayerLayout): HTMLElement {
  const mini = h(
    'span',
    // Left to right in every language, as the player itself is (player/index.ts).
    { class: 'pl-mini', 'aria-hidden': 'true', dir: 'ltr' },
    part('top', part('back'), part('title'), part('clock'), part('chip')),
    part('info', part('info-title'), part('info-meta'), ...parts('info-line', 2)),
    part('center', part('c-skip'), part('c-play'), part('c-skip')),
    part(
      'bottom',
      part('seek', part('fill'), ...parts('mark', 3)),
      part('row', part('play'), ...parts('skip', 2), part('vol'), part('time'), part('name'), part('badges', ...parts('badge', 2)), part('next'), ...parts('btn', 3)),
      part('row2', ...parts('pill', 3)),
    ),
  );
  applyLayoutAttributes(mini, layout);
  return mini;
}

const POPUP_POSITIONS: readonly (readonly [VolumePopupPosition, string])[] = [
  ['center', t('settings.playback.volume-popup-center')],
  ['top', t('settings.playback.volume-popup-top')],
  ['top-start', t('settings.playback.volume-popup-top-start')],
  ['top-end', t('settings.playback.volume-popup-top-end')],
];

const seconds = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(n);

/** A switch for a setting, labelled for screen readers by its row. */
function settingSwitch(key: string, label: MessageKey, on: boolean): HTMLElement {
  const control = createSwitch('', on, (value) => void save(key, value));
  control.setAttribute('aria-label', t(label));
  return control;
}

/** Volume pop-up on or off, and where it shows (only while it's on). */
function volumePopupRows(on: boolean, position: VolumePopupPosition): HTMLElement[] {
  const control = createSwitch('', on, (value) => {
    showDependents(popupRow, [positionRow], value);
    void save(VOLUME_POPUP_KEY, value);
  });
  control.setAttribute('aria-label', t('settings.playback.volume-popup'));
  const popupRow = row(t('settings.playback.volume-popup'), t('settings.playback.volume-popup-hint'), control);
  const positionRow = row(t('settings.playback.volume-popup-position'), t('settings.playback.volume-popup-position-hint'), choices(t('settings.playback.volume-popup-position'), POPUP_POSITIONS, position, (v) => void save(VOLUME_POPUP_POSITION_KEY, v)));
  showDependents(popupRow, [positionRow], on);
  return [popupRow, positionRow];
}

/** Player → Controls, then Window & extras: the jump length, the volume boost, the player's keys and extras, how its window behaves, and seek bar previews, read when the player opens. */
export function playerBehaviourPanel(): HTMLElement {
  const panel = h('div', {});
  // Per profile; the Android TV player keeps its own buffer, so it isn't offered there.
  const rewindCache = h('div', {});
  if (!isAndroid) {
    void profileSetting(REWIND_CACHE_PREFIX)
      .catch(() => ({ key: REWIND_CACHE_PREFIX, value: null }))
      .then(({ key, value }) => {
        const options: readonly (readonly [RewindPreset, string])[] = [
          ['standard', t('settings.player.rewind-standard')],
          ['more', t('settings.player.rewind-more')],
          ['most', t('settings.player.rewind-most')],
        ];
        rewindCache.replaceChildren(row(t('settings.player.rewind'), t('settings.player.rewind-hint'), choices(t('settings.player.rewind'), options, parseRewindCache(value), (v) => void save(key, v))));
      });
  }
  const keys = [SEEK_STEP_KEY, VOLUME_BOOST_KEY, HOLD_BOOST_KEY, NUMBER_JUMP_KEY, GRAYSCALE_PAUSE_KEY, PLAYBACK_SETTINGS.pauseOnMinimize, PLAYBACK_SETTINGS.keepFullscreen, VOLUME_POPUP_KEY, VOLUME_POPUP_POSITION_KEY, PREVIEWS_KEY, DOUBLE_CLICK_SEEK_KEY];
  void Promise.all(keys.map((key) => settings.get(key).catch(() => null))).then(([step, boost, hold, numbers, gray, pauseOnMinimize, keepFullscreen, volumePopup, popupPosition, previews, doubleClick]) => {
    const boostSwitch = createSwitch('', boost === true, (on) => void save(VOLUME_BOOST_KEY, on));
    boostSwitch.setAttribute('aria-label', t('settings.player.volume-boost'));
    panel.replaceChildren(
      chapter('settingslayout.chapter.player-controls'),
      row(
        t('settings.player.seek-step'),
        t('settings.player.seek-step-hint'),
        choices(t('settings.player.seek-step'), SEEK_STEPS.map((n) => [n, seconds(n)] as const), parseSeekStep(step), (v) => void save(SEEK_STEP_KEY, v)),
      ),
      row(t('settings.player.volume-boost'), t('settings.player.volume-boost-hint'), boostSwitch),
      row(t('playerplus.settings.hold-boost'), t('playerplus.settings.hold-boost-hint'), settingSwitch(HOLD_BOOST_KEY, 'playerplus.settings.hold-boost', hold !== false)),
      row(t('playerplus.settings.number-jump'), t('playerplus.settings.number-jump-hint'), settingSwitch(NUMBER_JUMP_KEY, 'playerplus.settings.number-jump', numbers !== false)),
      row(t('pstream.settings.double-click'), t('pstream.settings.double-click-hint'), settingSwitch(DOUBLE_CLICK_SEEK_KEY, 'pstream.settings.double-click', doubleClick === true)),
      ...volumePopupRows(volumePopup === true, parseVolumePopupPosition(popupPosition)),
      chapter('settingslayout.chapter.player-window'),
      row(t('settings.playback.pause-minimized'), t('settings.playback.pause-minimized-hint'), settingSwitch(PLAYBACK_SETTINGS.pauseOnMinimize, 'settings.playback.pause-minimized', pauseOnMinimize !== false)),
      row(t('settings.playback.keep-fullscreen'), t('settings.playback.keep-fullscreen-hint'), settingSwitch(PLAYBACK_SETTINGS.keepFullscreen, 'settings.playback.keep-fullscreen', keepFullscreen === true)),
      row(t('playerplus.settings.grayscale'), t('playerplus.settings.grayscale-hint'), settingSwitch(GRAYSCALE_PAUSE_KEY, 'playerplus.settings.grayscale', gray === true)),
      row(t('settings.video.previews'), t('settings.video.previews-hint'), settingSwitch(PREVIEWS_KEY, 'settings.video.previews', previews !== false)),
      rewindCache,
    );
  });
  return panel;
}

/** Player → How it looks: the layout, the episodes list, a link to the seek bar (edited in Theme Studio) and its colour. */
export function playerLookPanel(): HTMLElement {
  const episodes = h('div', {});
  void settings
    .get(EPISODES_DOCKED_KEY)
    .catch(() => null)
    .then((docked) =>
      episodes.replaceChildren(
        row(
          t('playerplus.settings.episodes'),
          t('playerplus.settings.episodes-hint'),
          choices(t('playerplus.settings.episodes'), [[false, t('playerplus.settings.episodes-floating')], [true, t('playerplus.settings.episodes-docked')]] as const, docked === true, (v) => void save(EPISODES_DOCKED_KEY, v)),
        ),
      ),
    );
  return h('div', {}, chapter('settingslayout.chapter.player-look'), layoutPanel(), episodes, seekBarLink(), playerColourRow(t('playercolour.seek-label')));
}

function layoutPanel(): HTMLElement {
  const panel = h('div', { class: 'player-layout-settings settings-split' });
  let layout: PlayerLayout = { ...DEFAULT_LAYOUT };

  function change(next: PlayerLayout, redraw: boolean): void {
    layout = next;
    void save(PLAYER_LAYOUT_KEY, layout);
    layoutChanged(layout);
    if (redraw) draw();
    else applyLayoutAttributes(preview, layout);
  }

  let preview = miniature(layout);

  function presetCard(preset: Preset): HTMLElement {
    const card = h(
      'button',
      { class: 'theme-card pl-card', 'aria-pressed': String(layout.preset === preset), 'data-focus-id': `preset-${preset}` },
      miniature(choosePreset(layout, preset)),
      h('span', { class: 'theme-card-name' }, PRESET_NAMES[preset]),
      h('span', { class: 'pl-card-hint' }, PRESET_HINTS[preset]),
    );
    card.addEventListener('click', () => change(choosePreset(layout, preset), true));
    return card;
  }

  /** Segmented choices, tagged so focus survives a redraw. */
  function segments<T extends string>(id: string, label: string, options: readonly T[], names: Record<T, string>, current: T, onPick: (value: T) => void): HTMLElement {
    const control = choices(label, options.map((value) => [value, names[value]] as const), current, onPick);
    control.querySelectorAll<HTMLElement>('.segment').forEach((button, i) => (button.dataset.focusId = `${id}-${options[i]}`));
    return control;
  }

  function draw(): void {
    const focused = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    preview = miniature(layout);
    const reset = h('button', { class: 'button', 'data-focus-id': 'reset' }, t('playerlook.reset'));
    reset.addEventListener('click', () => change({ ...DEFAULT_LAYOUT }, true));
    // The preview sits beside the rows that change it (settings-split, settings.css), and above them in a narrow window.
    panel.replaceChildren(
      h(
        'div',
        { class: 'settings-split-main' },
        row(t('playerlook.layout'), t('playerlook.layout-hint'), reset),
        h('div', { class: 'theme-grid pl-grid', role: 'group', 'aria-label': t('playerlook.presets-label') }, ...PRESETS.map(presetCard)),
        row(t('playerlook.size'), t('playerlook.size-hint'), segments('size', t('playerlook.size'), SIZES, SIZE_NAMES, layout.size, (size) => { const next = { ...layout, size }; delete next.scale; change(next, false); })),
        row(t('playerlook.background'), t('playerlook.background-hint'), segments('background', t('playerlook.background'), BACKGROUNDS, BACKGROUND_NAMES, layout.background, (background) => change({ ...layout, background }, false))),
        row(t('playerlook.timeline'), t('playerlook.timeline-hint'), segments('timeline', t('playerlook.timeline'), TIMELINES, TIMELINE_NAMES, layout.timeline, (timeline) => change({ ...layout, timeline }, false))),
        ...SWITCHES.map(({ key, label, hint }) => {
          // The preset cards draw the clock too.
          const control = createSwitch('', layout[key], (on) => change({ ...layout, [key]: on }, key === 'clock'));
          control.setAttribute('aria-label', t(label));
          control.dataset.focusId = `switch-${key}`;
          return row(t(label), t(hint), control);
        }),
      ),
      h('figure', { class: 'pl-preview settings-split-aside' }, preview, h('figcaption', { class: 'setting-hint' }, t('playerlook.preview'))),
    );
    // Now rather than when the page's observer runs, so focus can go back to a choice row's value.
    compactRows(panel);
    if (focused) panel.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  void loadPlayerLayout().then((saved) => {
    layout = saved;
    draw();
  });
  // A Look (Settings → Appearance) changes the layout too; this page follows (its own changes come back as the same object).
  const stop = watchPlayerLayout((next) => {
    // The page was drawn again since, with a panel of its own.
    if (!onSettingsPage(panel)) return void stop();
    if (next === layout) return;
    layout = next;
    if (panel.isConnected) draw();
  });
  return panel;
}
