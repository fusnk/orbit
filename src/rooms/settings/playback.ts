/**
 * Settings → Playback: pressing Play and resuming, the next episode (the
 * Next Up card, per the design), skipping, and trailers. (Player behaviour
 * and the external player follow it on the page, from player.ts and
 * external-player.ts.) Also Addons & Sources → Source preferences: the
 * rules for choosing a source.
 */
import { createSlider } from '../../components/slider';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t, tn, type MessageKey } from '../../i18n';
import { MAX_LIMIT_GB, parseAutoplayLimits, qualityRank, type AutoplayLimits } from '../../lib/autoplay';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { MAX_KEYWORD_LENGTH, MAX_KEYWORDS, MIN_SIZE_LIMITS, parseKeywords, parseSourceRules, SIZE_LIMITS, type AvoidRule, type PreferRule, type Resolution, type SourceRules } from '../../lib/ranking-fallback';
import { AUTOPLAY_LIMITS_PREFIX, loadRankingPrefs, parseQuality, parseTorrentMode, QUALITIES, QUALITY_KEY, RULES_KEY, TORRENT_KEY } from '../detail/ranking-prefs';
import './autoplay-limits.css';
import { AUTOPLAY_LIMITS, countdownSeconds, parseAutoplayLimit, parseAutoplayMode, PLAYBACK_SETTINGS, type AutoplayMode } from '../player/next-up';
import { parseResumeSourceMode, RESUME_SOURCE_PREFIX, type ResumeSourceMode } from '../player/last-source';
import { FILM_END_KEY, parseFilmEnd } from '../player/end-screen-rules';
import { AUTO_SKIP_DELAY_KEY, AUTO_SKIP_DELAYS, parseAutoSkipDelay, parseSkipModes, SEGMENT_KINDS, SKIP_MODES, SKIP_MODES_KEY, type SegmentKind, type SkipMode, type SkipModes } from '../player/skip';
import { LEARN_SKIPS_KEY, learnedSkips } from '../player/learned-skips';
import { ANISKIP_KEY, parseAniSkip, parseSegmentColors, parseSkipButtonDelay, parseSkipLanding, parseSmoothSkip, SEGMENT_COLORS_KEY, SEGMENT_SWATCHES, SKIP_BUTTON_DELAY_KEY, SKIP_BUTTON_DELAYS, SKIP_LANDING_KEY, SKIP_LANDINGS, SMOOTH_SKIP_KEY, SWATCH_NAMES, type SegmentColors, type SegmentSwatch } from '../player/skip-tuning';
import { profileSetting } from '../../library/profiles';
import { BANNER_TRAILER_KEY, HERO_TRAILER_KEY, parseTrailerDelay, TRAILER_DELAY_KEY, TRAILER_SOUND_KEY, trailerSound } from '../detail/trailer-settings';
import { autoplayFollowUpsShown, countdownRowsShown, resumeSourceShown, showDependents, trailerFollowUpsShown, whenSaved } from './dependent-rows';
import { isAndroid } from '../../lib/platform';
import { syncWatchNext, WATCH_NEXT_KEY } from '../../library/watch-next';
import { nextUpRows } from './next-up-rows';

const RESUME_CHOICES = [
  ['always', t('settings.playback.resume-always')],
  ['start-over', t('settings.playback.resume-start-over')],
  ['ask', t('settings.playback.resume-ask')],
] as const;

const RESUME_SOURCE_CHOICES: readonly (readonly [ResumeSourceMode, string])[] = [
  ['ask', t('settings.playback.resume-source-ask')],
  ['last', t('settings.playback.resume-source-last')],
  ['choose', t('settings.playback.resume-source-choose')],
  ['best', t('settings.playback.resume-source-best')],
];

const AUTOPLAY_CHOICES: readonly (readonly [AutoplayMode, string])[] = [
  ['always', t('watching.autoplay.always')],
  ['ask', t('watching.autoplay.ask')],
  ['never', t('watching.autoplay.never')],
];

const LIMIT_CHOICES = AUTOPLAY_LIMITS.map((n) => [n, n === 0 ? t('settings.common.off') : tn('watching.autoplay.episodes', n)] as const);

const seconds = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(n);
const COUNTDOWN_CHOICES = [
  [5, seconds(5)],
  [10, seconds(10)],
  [15, seconds(15)],
  [0, t('settings.common.off')],
] as const;

const gigabytes = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'gigabyte', unitDisplay: 'short' }).format(n);
const SIZE_CHOICES = SIZE_LIMITS.map((n) => [n, n === 0 ? t('settings.common.off') : gigabytes(n)] as const);
const MIN_SIZE_CHOICES = MIN_SIZE_LIMITS.map((n) => [n, n === 0 ? t('settings.common.off') : gigabytes(n)] as const);
const QUALITY_LIMITS: readonly (readonly [Resolution | null, string])[] = [
  [null, t('settings.common.off')],
  ['1080p', '1080p'],
  ['720p', '720p'],
];

const AVOID_CHIPS: readonly (readonly [AvoidRule, MessageKey])[] = [
  ['cam', 'settings.playback.avoid-cam'],
  ['hdr', 'settings.playback.avoid-hdr'],
  ['dv', 'settings.playback.avoid-dv'],
  ['hevc', 'settings.playback.avoid-hevc'],
  ['av1', 'settings.playback.avoid-av1'],
  ['3d', 'settings.playback.avoid-3d'],
  ['remux', 'settings.playback.avoid-remux'],
];
const PREFER_CHIPS: readonly (readonly [PreferRule, MessageKey])[] = [
  ['cached', 'settings.playback.prefer-cached'],
  ['hdr', 'settings.playback.prefer-hdr'],
  ['audio', 'settings.playback.prefer-audio'],
];

/** Saves a setting, saying so if it fails; resolves either way. */
export function save(key: string, value: unknown): Promise<void> {
  return settings.set(key, value).catch((err: unknown) => {
    console.error('Could not save setting', err);
    toast(t('settings.common.save-failed'));
  });
}

let hintIds = 0;

export function row(label: string, hint: string, control: HTMLElement): HTMLElement {
  const hintText = h('span', { class: 'setting-hint' }, hint);
  // The hint is read with the control (a switch, a group of choices), not only seen beside it.
  if (hint && control.matches('button, input, select, textarea, [role]') && !control.hasAttribute('aria-describedby')) {
    hintText.id = `setting-hint-${++hintIds}`;
    control.setAttribute('aria-describedby', hintText.id);
  }
  return h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), hintText), control);
}

/** A chapter's heading on a Settings page: what the simple view folds and the palette finds by. */
export const chapter = (label: MessageKey): HTMLElement => h('h3', { class: 'settings-subheading' }, t(label));

/**
 * Segmented choices (not a <select>: arrow keys on a select change it, turning
 * navigation into editing). For three or more choices, or two that aren't
 * on and off; on/off is a switch. As `'tabs'`, they switch between views, so
 * they say so (tablist, tab, aria-selected) rather than being pressed buttons.
 */
export function choices<T>(label: string, options: readonly (readonly [T, string])[], current: T, onPick: (value: T) => void, kind: 'choices' | 'tabs' = 'choices'): HTMLElement {
  const tabs = kind === 'tabs';
  const buttons = options.map(([value, text]) => {
    const button = h('button', { class: 'segment', ...(tabs ? { role: 'tab' } : {}), [stateOf(tabs)]: String(value === current) }, text);
    button.addEventListener('click', () => {
      for (const b of buttons) b.setAttribute(stateOf(tabs), String(b === button));
      onPick(value);
    });
    return button;
  });
  return h('div', { class: 'segments', role: tabs ? 'tablist' : 'group', 'aria-label': label }, ...buttons);
}

const stateOf = (tab: boolean) => (tab ? 'aria-selected' : 'aria-pressed');

/** Presses the segment for `value` in a `choices` group built from `options` (e.g. after the setting changed elsewhere). */
export function pressChoice<T>(group: HTMLElement, options: readonly (readonly [T, string])[], value: T): void {
  [...group.children].forEach((button, i) => button.setAttribute(stateOf(button.getAttribute('role') === 'tab'), String(options[i]?.[0] === value)));
}

/** A setting whose control sits under its text (a row of chips, a text field). */
function stackedRow(label: string, hint: string, control: HTMLElement): HTMLElement {
  const element = row(label, hint, control);
  element.classList.add('stacked');
  return element;
}

/** Toggle chips: any number can be on. `sync` redraws them from `isOn`. */
function chipSet<T>(label: string, options: readonly (readonly [T, MessageKey])[], isOn: (value: T) => boolean, onToggle: (value: T, on: boolean) => void): { element: HTMLElement; sync(): void } {
  const buttons = options.map(([value, key]) => {
    const button = h('button', { class: 'chip', 'aria-pressed': String(isOn(value)) }, t(key));
    button.addEventListener('click', () => onToggle(value, button.getAttribute('aria-pressed') !== 'true'));
    return [value, button] as const;
  });
  return {
    element: h('div', { class: 'chips', role: 'group', 'aria-label': label }, ...buttons.map(([, b]) => b)),
    sync: () => {
      for (const [value, button] of buttons) button.setAttribute('aria-pressed', String(isOn(value)));
    },
  };
}

/**
 * Addons & Sources → Source preferences: limits, things to avoid or prefer,
 * and keywords. They only reorder sources (see ranking-fallback.ts); none is
 * ever hidden, so Play still finds something when every source breaks a rule.
 */
function sourceRules(saved: unknown): HTMLElement[] {
  let rules = parseSourceRules(saved);
  const update = (change: Partial<SourceRules>) => {
    rules = parseSourceRules({ ...rules, ...change });
    void save(RULES_KEY, rules).then(loadRankingPrefs);
  };
  const toggled = <T>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));

  // Avoiding HDR and preferring it can't both be on: turning one on turns the other off.
  const avoid = chipSet(t('settings.playback.avoid'), AVOID_CHIPS, (rule) => rules.avoid.includes(rule), (rule, on) => {
    update({ avoid: toggled(rules.avoid, rule, on), prefer: rule === 'hdr' && on ? rules.prefer.filter((p) => p !== 'hdr') : rules.prefer });
    avoid.sync();
    prefer.sync();
  });
  const prefer = chipSet(t('settings.playback.prefer'), PREFER_CHIPS, (rule) => rules.prefer.includes(rule), (rule, on) => {
    update({ prefer: toggled(rules.prefer, rule, on), avoid: rule === 'hdr' && on ? rules.avoid.filter((a) => a !== 'hdr') : rules.avoid });
    avoid.sync();
    prefer.sync();
  });

  const keywords = (label: string, field: 'preferWords' | 'avoidWords') => {
    const input = createTextField({ label, placeholder: t('settings.playback.keywords-placeholder'), onSubmit: () => commit() });
    // Shows the list as saved: lowercased, without repeats, capped.
    const commit = () => {
      update({ [field]: parseKeywords(input.value) });
      input.value = rules[field].join(', ');
    };
    input.value = rules[field].join(', ');
    input.maxLength = MAX_KEYWORDS * (MAX_KEYWORD_LENGTH + 2);
    input.addEventListener('change', commit);
    return input;
  };

  // A minimum at or above the maximum would leave nothing inside the limits, so picking one clears the other.
  const maxSize = choices(t('settings.playback.max-size'), SIZE_CHOICES, rules.maxSizeGB, (v) => {
    const clash = v > 0 && rules.minSizeGB >= v;
    update({ maxSizeGB: v, ...(clash ? { minSizeGB: 0 } : {}) });
    if (clash) pressChoice(minSize, MIN_SIZE_CHOICES, 0);
  });
  const minSize = choices(t('sources.rules.min-size'), MIN_SIZE_CHOICES, rules.minSizeGB, (v) => {
    const clash = v > 0 && rules.maxSizeGB > 0 && v >= rules.maxSizeGB;
    update({ minSizeGB: v, ...(clash ? { maxSizeGB: 0 } : {}) });
    if (clash) pressChoice(maxSize, SIZE_CHOICES, 0);
  });

  const multiAudio = createSwitch('', rules.prefer.includes('multi-audio'), (on) => update({ prefer: toggled(rules.prefer, 'multi-audio', on) }));
  multiAudio.setAttribute('aria-label', t('settings.playback.multi-audio'));

  return [
    chapter('settingslayout.chapter.ranking-rules'),
    row(t('settings.playback.max-quality'), t('settings.playback.max-quality-hint'), choices(t('settings.playback.max-quality'), QUALITY_LIMITS, rules.maxQuality, (v) => update({ maxQuality: v }))),
    row(t('settings.playback.max-size'), t('settings.playback.max-size-hint'), maxSize),
    row(t('sources.rules.min-size'), t('sources.rules.min-size-hint'), minSize),
    row(t('settings.playback.multi-audio'), t('settings.playback.multi-audio-hint'), multiAudio),
    stackedRow(t('settings.playback.avoid'), t('settings.playback.avoid-hint'), avoid.element),
    stackedRow(t('settings.playback.prefer'), t('settings.playback.prefer-hint'), prefer.element),
    stackedRow(t('settings.playback.prefer-words'), t('settings.playback.prefer-words-hint'), keywords(t('settings.playback.prefer-words'), 'preferWords')),
    stackedRow(t('settings.playback.avoid-words'), t('settings.playback.avoid-words-hint'), keywords(t('settings.playback.avoid-words'), 'avoidWords')),
  ];
}

const LIMIT_QUALITY_CHOICES: readonly (readonly [Resolution | null, string])[] = [[null, t('sources.limits.any')], ['720p', '720p'], ['1080p', '1080p'], ['2160p', '4K']];

/** Presses the segment for `value` in a `choices` group built from LIMIT_QUALITY_CHOICES. */
function pressQuality(group: HTMLElement, value: Resolution | null): void {
  pressChoice(group, LIMIT_QUALITY_CHOICES, value);
}

/**
 * Addons & Sources → Source preferences → Autoplay limits (per profile): what Play and the
 * next episode may start on their own (see lib/autoplay.ts). The lowest
 * quality can't sit above the highest: raising one past the other moves it too.
 */
function autoplayLimitRows(saved: { key: string; value: unknown }): HTMLElement[] {
  let limits = parseAutoplayLimits(saved.value);
  let timer: number | undefined;
  const store = () => void save(saved.key, limits).then(loadRankingPrefs);
  // A slider changes on every step while it moves: its value is saved once it settles.
  const update = (change: Partial<AutoplayLimits>, settle = false) => {
    limits = parseAutoplayLimits({ ...limits, ...change });
    window.clearTimeout(timer);
    if (settle) timer = window.setTimeout(store, 400);
    else store();
  };
  const above = (a: Resolution | null, b: Resolution | null) => !!a && !!b && qualityRank(a) > qualityRank(b);
  const min = choices(t('sources.limits.min-quality'), LIMIT_QUALITY_CHOICES, limits.minQuality, (value) => {
    const raise = above(value, limits.maxQuality);
    if (raise) pressQuality(max, value);
    update(raise ? { minQuality: value, maxQuality: value } : { minQuality: value });
  });
  const max = choices(t('sources.limits.max-quality'), LIMIT_QUALITY_CHOICES, limits.maxQuality, (value) => {
    const lower = above(limits.minQuality, value);
    if (lower) pressQuality(min, value);
    update(lower ? { maxQuality: value, minQuality: value } : { maxQuality: value });
  });
  const size = createSlider({
    label: t('sources.limits.max-size'),
    min: 0,
    max: MAX_LIMIT_GB,
    value: limits.maxSizeGB,
    format: (n) => (n === 0 ? t('sources.limits.any') : gigabytes(n)),
    focusId: 'autoplay-max-size',
    onInput: (value) => update({ maxSizeGB: value }, true),
  });
  return [
    h('h3', { class: 'settings-subheading appearance-section' }, t('sources.limits.heading')),
    row(t('sources.limits.min-quality'), t('sources.limits.min-quality-hint'), min),
    row(t('sources.limits.max-quality'), t('sources.limits.max-quality-hint'), max),
    row(t('sources.limits.max-size'), t('sources.limits.max-size-hint'), h('div', { class: 'autoplay-size' }, size)),
  ];
}

const SKIP_KIND_NAMES: Record<SegmentKind, MessageKey> = {
  intro: 'playerplus.settings.skip-intro',
  recap: 'playerplus.settings.skip-recap',
  credits: 'playerplus.settings.skip-credits',
  preview: 'playerplus.settings.skip-preview',
};
const SKIP_MODE_NAMES: Record<SkipMode, MessageKey> = { off: 'playerplus.settings.skip-off', button: 'playerplus.settings.skip-button', auto: 'playerplus.settings.skip-auto' };

/**
 * What happens in each kind of segment: nothing, a Skip button, or skipped
 * without asking. Saved together; the first change also carries over what
 * the old single "skip intros and recaps" switch said for the others.
 * Quick settings' "Skip intros" writes the same setting, so the rows follow it.
 */
function skipRows(saved: unknown, legacyAuto: unknown): HTMLElement[] {
  let modes: SkipModes = parseSkipModes(saved, legacyAuto);
  const options = SKIP_MODES.map((mode) => [mode, t(SKIP_MODE_NAMES[mode])] as const);
  const groups = SEGMENT_KINDS.map((kind) =>
    choices(t(SKIP_KIND_NAMES[kind]), options, modes[kind], (mode) => {
      modes = { ...modes, [kind]: mode };
      void save(SKIP_MODES_KEY, modes);
    }),
  );
  whenSaved(SKIP_MODES_KEY, groups[0]!, (value) => {
    modes = parseSkipModes(value, legacyAuto);
    SEGMENT_KINDS.forEach((kind, i) => pressChoice(groups[i]!, options, modes[kind]));
  });
  // How long Automatic waits, counting down on the Skip button (any key stops it).
  const delay = h('div', {});
  void settings
    .get(AUTO_SKIP_DELAY_KEY)
    .catch(() => null)
    .then((saved) => {
      const delays = AUTO_SKIP_DELAYS.map((d) => [d, d === 0 ? t('playerplus.settings.skip-delay-none') : seconds(d)] as const);
      delay.replaceChildren(row(t('playerplus.settings.skip-delay'), t('playerplus.settings.skip-delay-hint'), choices(t('playerplus.settings.skip-delay'), delays, parseAutoSkipDelay(saved), (v) => void save(AUTO_SKIP_DELAY_KEY, v))));
    });
  return [
    h('h3', { class: 'settings-subheading appearance-section' }, t('playerplus.settings.skipping')),
    ...SEGMENT_KINDS.map((kind, i) => row(t(SKIP_KIND_NAMES[kind]), i === 0 ? t('playerplus.settings.skipping-hint') : '', groups[i]!)),
    delay,
    skipTuningRows(),
  ];
}

/** The theme's own colour for each kind on the seek bar, as playerplus.css draws it, for the Standard swatch. */
const DEFAULT_BANDS: Record<SegmentKind, string> = {
  intro: 'var(--color-rating)',
  recap: 'color-mix(in srgb, var(--color-rating) 45%, #8fb8ff)',
  credits: 'rgba(255, 255, 255, 0.55)',
  preview: 'color-mix(in srgb, rgba(255, 255, 255, 0.55) 60%, var(--color-accent))',
};

/** Each kind's colour row on the seek bar. */
const COLOR_LABELS: Record<SegmentKind, MessageKey> = { intro: 'movix.color-intro', recap: 'movix.color-recap', credits: 'movix.color-credits', preview: 'movix.color-preview' };

/** A row of colour swatches for one kind of segment; picking one presses it. */
function bandSwatches(kind: SegmentKind, current: SegmentSwatch, onPick: (swatch: SegmentSwatch) => void): HTMLElement {
  const names = Object.keys(SEGMENT_SWATCHES) as SegmentSwatch[];
  const buttons = names.map((swatch) => {
    const name = t(SWATCH_NAMES[swatch]);
    const button = h('button', { class: 'swatch', 'aria-label': name, title: name, 'aria-pressed': String(swatch === current) });
    button.style.setProperty('--swatch', SEGMENT_SWATCHES[swatch] || DEFAULT_BANDS[kind]);
    button.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      onPick(swatch);
    });
    return button;
  });
  return h('div', { class: 'swatches', role: 'group', 'aria-label': t(COLOR_LABELS[kind]) }, ...buttons);
}

/** Skipping's finer points (see player/skip-tuning.ts): the smooth skip, the button's wait, where a skip lands, and the seek bar's colours. */
function skipTuningRows(): HTMLElement {
  const rows = h('div', {});
  void Promise.all([SMOOTH_SKIP_KEY, SKIP_BUTTON_DELAY_KEY, SKIP_LANDING_KEY, SEGMENT_COLORS_KEY].map((key) => settings.get(key).catch(() => undefined))).then(([smooth, delay, landing, saved]) => {
    let colors: SegmentColors = parseSegmentColors(saved);
    const delays = SKIP_BUTTON_DELAYS.map((d) => [d, d === 0 ? t('movix.button-delay-none') : seconds(d)] as const);
    const landings = SKIP_LANDINGS.map((d) => [d, d === 0 ? t('movix.landing-none') : seconds(d)] as const);
    rows.replaceChildren(
      row(t('movix.smooth'), t('movix.smooth-hint'), labelledSwitch(t('movix.smooth'), parseSmoothSkip(smooth), (on) => void save(SMOOTH_SKIP_KEY, on))),
      // The rest only tunes skipping: a chapter of its own, folded away as a whole in the simple view.
      chapter('settingslayout.chapter.skip-tuning'),
      row(t('movix.button-delay'), t('movix.button-delay-hint'), choices(t('movix.button-delay'), delays, parseSkipButtonDelay(delay), (v) => void save(SKIP_BUTTON_DELAY_KEY, v))),
      row(t('movix.landing'), t('movix.landing-hint'), choices(t('movix.landing'), landings, parseSkipLanding(landing), (v) => void save(SKIP_LANDING_KEY, v))),
      ...SEGMENT_KINDS.map((kind, i) =>
        row(
          t(COLOR_LABELS[kind]),
          i === 0 ? t('movix.colors-hint') : '',
          bandSwatches(kind, colors[kind], (swatch) => {
            colors = { ...colors, [kind]: swatch };
            void save(SEGMENT_COLORS_KEY, colors);
          }),
        ),
      ),
    );
  });
  return rows;
}

/**
 * Learning intros from the person's own skips (see player/learned-skips.ts),
 * and forgetting what was learned (this profile's, kept on this device).
 */
function learnedSkipRows(learn: unknown): HTMLElement[] {
  const forget = h('button', { class: 'button' }, t('playerplus.settings.forget-skips-action'));
  forget.addEventListener('click', () => {
    void learnedSkips
      .forgetAll()
      .then(() => toast(t('playerplus.settings.forget-skips-done')))
      .catch((err: unknown) => {
        console.error('Could not forget learned intros', err);
        toast(t('settings.common.save-failed'));
      });
  });
  return [
    row(t('playerplus.settings.learn-skips'), t('playerplus.settings.learn-skips-hint'), labelledSwitch(t('playerplus.settings.learn-skips'), learn !== false, (on) => void save(LEARN_SKIPS_KEY, on))),
    row(t('playerplus.settings.forget-skips'), t('playerplus.settings.forget-skips-hint'), forget),
  ];
}

/** A switch labelled for screen readers by its row. */
function labelledSwitch(label: string, on: boolean, change: (on: boolean) => void): HTMLButtonElement {
  const control = createSwitch('', on, change);
  control.setAttribute('aria-label', label);
  return control;
}

/**
 * Trailers on title pages and on Home and Discover banners, then how long they
 * wait and whether they start with sound (only shown while either plays).
 * Quick settings' "Autoplay trailers" writes both switches, so they follow it.
 */
function trailerRows(hero: unknown, banner: unknown, delay: unknown, sound: unknown): HTMLElement[] {
  const state = { hero: hero === true, banner: banner === true };
  const update = () => showDependents(heroRow, [delayRow, soundRow], trailerFollowUpsShown(state.hero, state.banner));
  const trailerSwitch = (label: string, which: 'hero' | 'banner', key: string) =>
    labelledSwitch(label, state[which], (on) => {
      state[which] = on;
      update();
      void save(key, on);
    });
  const heroSwitch = trailerSwitch(t('settings.video.trailers'), 'hero', HERO_TRAILER_KEY);
  const bannerSwitch = trailerSwitch(t('settings.video.banner-trailers'), 'banner', BANNER_TRAILER_KEY);
  const heroRow = row(t('settings.video.trailers'), t('settings.video.trailers-hint'), heroSwitch);
  const delayRow = row(
    t('settings.video.trailer-delay'),
    t('settings.video.trailer-delay-hint'),
    choices(
      t('settings.video.trailer-delay'),
      [
        [1.5, t('settings.video.trailer-delay-short')],
        [3, t('settings.video.trailer-delay-seconds', { seconds: 3 })],
        [5, t('settings.video.trailer-delay-seconds', { seconds: 5 })],
      ] as const,
      parseTrailerDelay(delay),
      (v) => void save(TRAILER_DELAY_KEY, v),
    ),
  );
  const soundRow = row(t('settings.video.trailer-sound'), t('settings.video.trailer-sound-hint'), labelledSwitch(t('settings.video.trailer-sound'), trailerSound(sound), (on) => void save(TRAILER_SOUND_KEY, on)));
  for (const [key, which, control] of [
    [HERO_TRAILER_KEY, 'hero', heroSwitch],
    [BANNER_TRAILER_KEY, 'banner', bannerSwitch],
  ] as const) {
    whenSaved(key, control, (value) => {
      state[which] = value === true;
      control.setAttribute('aria-checked', String(state[which]));
      update();
    });
  }
  update();
  return [
    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.playback.trailers-heading')),
    heroRow,
    row(t('settings.video.banner-trailers'), t('settings.video.banner-trailers-hint'), bannerSwitch),
    delayRow,
    soundRow,
  ];
}

/**
 * Resume, which source to resume with (not when starting over), and autoplay
 * with the rows that only matter when it's not Never. Quick settings sets
 * autoplay too, so those rows follow it.
 */
function resumeAndAutoplayRows(resume: unknown, resumeSource: { key: string; value: unknown }, sameSource: unknown, autoplay: unknown, autoplayLimit: unknown, countdown: unknown): HTMLElement[] {
  const resumeRow = row(
    t('settings.playback.resume'),
    t('settings.playback.resume-hint'),
    choices(t('settings.playback.resume'), RESUME_CHOICES, resume === 'start-over' || resume === 'ask' ? resume : 'always', (v) => {
      showDependents(resumeRow, [resumeSourceRow], resumeSourceShown(v));
      void save(PLAYBACK_SETTINGS.resume, v);
    }),
  );
  // Per profile: which source to go on with is taste (see resume-choice.ts).
  const resumeSourceRow = row(t('settings.playback.resume-source'), t('settings.playback.resume-source-hint'), choices(t('settings.playback.resume-source'), RESUME_SOURCE_CHOICES, parseResumeSourceMode(resumeSource.value), (v) => save(resumeSource.key, v)));
  const autoplayChoice = choices(t('settings.playback.autoplay'), AUTOPLAY_CHOICES, parseAutoplayMode(autoplay), (v) => {
    showFollowUps(v);
    void save(PLAYBACK_SETTINGS.autoplay, v);
  });
  const autoplayRow = row(t('settings.playback.autoplay'), t('watching.autoplay.hint'), autoplayChoice);
  const counting = [
    row(t('watching.autoplay.limit'), t('watching.autoplay.limit-hint'), choices(t('watching.autoplay.limit'), LIMIT_CHOICES, parseAutoplayLimit(autoplayLimit), (v) => save(PLAYBACK_SETTINGS.autoplayLimit, v))),
    row(t('settings.playback.countdown'), t('settings.playback.countdown-hint'), choices(t('settings.playback.countdown'), COUNTDOWN_CHOICES, countdownSeconds(countdown), (v) => save(PLAYBACK_SETTINGS.countdown, v))),
  ];
  const card = nextUpRows();
  const followUps = [...counting, ...card];
  function showFollowUps(mode: AutoplayMode): void {
    showDependents(autoplayRow, counting, countdownRowsShown(mode));
    showDependents(autoplayRow, card, autoplayFollowUpsShown(mode));
  }
  whenSaved(PLAYBACK_SETTINGS.autoplay, autoplayChoice, (value) => {
    const mode = parseAutoplayMode(value);
    pressChoice(autoplayChoice, AUTOPLAY_CHOICES, mode);
    showFollowUps(mode);
  });
  showDependents(resumeRow, [resumeSourceRow], resumeSourceShown(resume));
  showFollowUps(parseAutoplayMode(autoplay));
  return [
    resumeRow,
    resumeSourceRow,
    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.playback.next-heading')),
    autoplayRow,
    ...followUps,
    row(t('settings.playback.same-source'), t('settings.playback.same-source-hint'), labelledSwitch(t('settings.playback.same-source'), sameSource !== false, (on) => void save(PLAYBACK_SETTINGS.sameSource, on))),
  ];
}

/** Android: switch the TV to the video's frame rate while it plays (read by Rust as a file opens, player/mod.rs). */
export const MATCH_RATE_KEY = 'playback.match-refresh';

export function playbackPanel(): HTMLElement {
  const panel = h('div', {});
  const keys = [PLAYBACK_SETTINGS.play, PLAYBACK_SETTINGS.resume, PLAYBACK_SETTINGS.autoplay, PLAYBACK_SETTINGS.autoplayLimit, PLAYBACK_SETTINGS.countdown, PLAYBACK_SETTINGS.skipLookup, PLAYBACK_SETTINGS.autoSkip, PLAYBACK_SETTINGS.sameSource, SKIP_MODES_KEY, HERO_TRAILER_KEY, BANNER_TRAILER_KEY, TRAILER_DELAY_KEY, TRAILER_SOUND_KEY, FILM_END_KEY, LEARN_SKIPS_KEY, MATCH_RATE_KEY, WATCH_NEXT_KEY, ANISKIP_KEY];
  void Promise.all([
    Promise.all(keys.map((key) => settings.get(key).catch(() => undefined))),
    profileSetting(RESUME_SOURCE_PREFIX).catch(() => ({ key: RESUME_SOURCE_PREFIX, value: null })),
  ]).then(([[play, resume, autoplay, autoplayLimit, countdown, skipLookup, autoSkip, sameSource, skipModes, heroTrailer, bannerTrailer, trailerDelay, trailerSoundOn, filmEnd, learnSkips, matchRate, watchNext, aniSkip], resumeSource]) => {
    panel.replaceChildren(
      chapter('settingslayout.chapter.starting'),
      row(
        t('settings.playback.play'),
        t('settings.playback.play-hint'),
        choices(t('settings.playback.play'), [['best', t('settings.playback.play-best')], ['choose', t('settings.playback.play-choose')]] as const, play === 'choose' ? 'choose' : 'best', (v) => save(PLAYBACK_SETTINGS.play, v)),
      ),
      ...resumeAndAutoplayRows(resume, resumeSource, sameSource, autoplay, autoplayLimit, countdown),
      row(t('playerlook.end.setting'), t('playerlook.end.setting-hint'), choices(t('playerlook.end.setting'), [['next', t('playerlook.end.show')], ['stop', t('playerlook.end.stop')]] as const, parseFilmEnd(filmEnd), (v) => save(FILM_END_KEY, v))),
      ...skipRows(skipModes, autoSkip),
      row(t('settings.playback.skip-lookup'), t('settings.playback.skip-lookup-hint'), labelledSwitch(t('settings.playback.skip-lookup'), skipLookup !== false, (on) => void save(PLAYBACK_SETTINGS.skipLookup, on))),
      row(t('movix.aniskip'), t('movix.aniskip-hint'), labelledSwitch(t('movix.aniskip'), parseAniSkip(aniSkip), (on) => void save(ANISKIP_KEY, on))),
      ...learnedSkipRows(learnSkips),
      ...trailerRows(heroTrailer, bannerTrailer, trailerDelay, trailerSoundOn),
      ...(isAndroid
        ? [
            row(t('settings.playback.match-rate'), t('settings.playback.match-rate-hint'), labelledSwitch(t('settings.playback.match-rate'), matchRate === true, (on) => void save(MATCH_RATE_KEY, on))),
            row(t('settings.playback.watch-next'), t('settings.playback.watch-next-hint'), labelledSwitch(t('settings.playback.watch-next'), watchNext === true, (on) => void save(WATCH_NEXT_KEY, on).then(syncWatchNext))),
          ]
        : []),
    );
  });
  return panel;
}

/** Addons & Sources → Source preferences: the quality to look for, torrents, what happens when a source fails, and the ranking rules. */
export function sourcePreferencesPanel(): HTMLElement {
  const panel = h('div', {});
  const keys = [QUALITY_KEY, TORRENT_KEY, PLAYBACK_SETTINGS.autoSwitch, RULES_KEY];
  void Promise.all([
    Promise.all(keys.map((key) => settings.get(key).catch(() => undefined))),
    profileSetting(AUTOPLAY_LIMITS_PREFIX).catch(() => ({ key: AUTOPLAY_LIMITS_PREFIX, value: null })),
  ]).then(([[quality, torrents, autoSwitch, rules], limits]) => {
    panel.replaceChildren(
      chapter('settingslayout.chapter.choosing-source'),
      h('p', { class: 'muted settings-intro' }, t('settings.sources.intro')),
      row(
        t('settings.playback.quality'),
        t('settings.playback.quality-hint'),
        choices(t('settings.playback.quality'), QUALITIES, parseQuality(quality), (v) => void save(QUALITY_KEY, v).then(loadRankingPrefs)),
      ),
      // Where the video may come from: with the other choices about sources.
      row(
        t('settings.playback.torrents'),
        t('settings.playback.torrents-hint'),
        choices(
          t('settings.playback.torrents'),
          [
            ['off', t('settings.common.off')],
            ['download', t('settings.playback.torrents-download')],
            ['share', t('settings.playback.torrents-share')],
          ] as const,
          parseTorrentMode(torrents),
          (v) => void save(TORRENT_KEY, v).then(loadRankingPrefs),
        ),
      ),
      row(
        t('settings.playback.source-fails'),
        t('settings.playback.source-fails-hint'),
        choices(t('settings.playback.source-fails'), [[true, t('settings.playback.source-fails-next')], [false, t('settings.playback.source-fails-error')]] as const, autoSwitch !== false, (v) => void save(PLAYBACK_SETTINGS.autoSwitch, v)),
      ),
      ...sourceRules(rules),
      ...autoplayLimitRows(limits),
    );
  });
  return panel;
}
