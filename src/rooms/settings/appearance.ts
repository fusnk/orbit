/**
 * Settings → Appearance → App: Looks, Theme Studio, theme and accent, the
 * menu, backgrounds, title pages, posters, the little extras and ambient
 * mode. (Scale, motion and effects are under General → Comfort; the seek
 * bar's link is on the Player tab, with the rest of the player's look.)
 *
 * Theme Studio owns the editors: each colour, the seek bar and the menu's
 * pages are edited there, and rows here open it at the right place. The
 * single choices both offer (glow, corners…) come from one definition,
 * studio/look-choices.ts.
 */
import type { Title } from '../../catalog/titles';
import { createSwitch } from '../../components/switch';
import { HOVER_INFO_KEY, setHoverInfo } from '../../components/hover-info';
import { toast } from '../../components/toast';
import { locale, t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { AUTO_EFFECTS_CHANGED, autoReason } from '../../theme/auto-effects';
import { appearance, clearWallpaper, hasWallpaper, HERO_COUNTS, SCALES, setAppearance, setWallpaper, type Appearance } from '../../theme/appearance';
import { looksSection } from './looks';
import { titleCard } from '../title-card';
import { coloursSection } from './themes';
import { choices, row } from './playback';
import { previewAmbient } from '../ambient';
import { AMBIENT_AFTER_CHOICES, ambientPrefs, setAmbientPrefs, type AmbientPrefs } from '../ambient/settings';
import { icon } from '../../components/icons';
import { setNavLayout, type LookAppearance } from '../../theme/engine';
import { currentNavLayout, NAV_POSITIONS, type NavLayout, type NavPosition } from '../../theme/layout';
import { pillPlacePicker } from '../studio/pill-place';
import { openThemeStudio } from '../studio';
import { CORNERS, DETAIL_BACKGROUND, GLOW, HERO_STYLE, optionsOf, POSTER_SIZE, type LookChoice } from '../studio/look-choices';
import { studioLink } from './studio-link';
import { funPrefs, setFun } from '../../app/fun-settings';
import type { FunPrefs } from '../../lib/fun';
import { ambientFollowUpsShown, showDependents, whileOnPage } from './dependent-rows';
import { errorText } from '../../components/state-message';
import { isAndroid } from '../../lib/platform';
import { posterRows } from './posters';

/** General → Comfort & accessibility: interface scale, reduce motion, reduce visual effects. */
export function comfortRows(): HTMLElement[] {
  const a = appearance();
  return [
    row(
      t('settings.appearance.scale'),
      t('settings.appearance.scale-hint'),
      choices(t('settings.appearance.scale'), SCALES.map((s) => [s, new Intl.NumberFormat(locale(), { style: 'percent' }).format(s / 100)] as const), a.scale, (scale) => set({ scale })),
    ),
    row(
      t('settings.appearance.motion'),
      t(isAndroid ? 'settings.appearance.motion-hint-android' : 'settings.appearance.motion-hint'),
      choices(t('settings.appearance.motion'), [['system', t('settings.common.system')], ['reduce', t('settings.common.on')], ['full', t('settings.common.off')]] as const, a.motion, (motion) => set({ motion })),
    ),
    effectsRow(a.effects),
  ];
}

/** The seek bar's look (Player → How it looks): edited in Theme Studio, which this row opens. */
export function seekBarLink(): HTMLElement {
  return studioLink(t('studio.seek.heading'), t('settings.appearance.seekbar-hint'), 'seekbar');
}

const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

function failed(err: unknown): void {
  console.error('Could not save setting', err);
  toast(t('settings.common.save-failed'));
}

const set = (patch: Partial<Appearance>) => void setAppearance(patch).catch(failed);

/** A choice Theme Studio offers too, saved at once; `name` when the row's heading already says what it's about. */
function lookRow<K extends keyof LookAppearance>(choice: LookChoice<K>, name = t(choice.label)): HTMLElement {
  return row(name, t(choice.hint), choices(t(choice.label), optionsOf(choice), appearance()[choice.field], (value) => set({ [choice.field]: value })));
}

export function appearancePanel(): HTMLElement {
  const panel = h('div', {});
  // A Look changes settings the rows below show, so the whole page draws again after one.
  const draw = () => panel.replaceChildren(looksSection('settings', draw), ...rows(draw));
  draw();
  return panel;
}

function rows(redraw: () => void): HTMLElement[] {
  const a = appearance();

  // A sample card, so shape, size, corner and score changes show straight away.
  const sample: Title = { id: 'preview', type: 'movie', name: t('settings.appearance.preview'), rating: '8.1', genres: [], origins: [] };
  const preview = h('div', { class: 'poster-preview', 'aria-hidden': 'true' }, titleCard(sample, () => {}));

  const studio = h('button', { class: 'button primary large' }, icon('palette'), t('studio.open'));
  studio.addEventListener('click', () => openThemeStudio());

  return [
    h('div', { class: 'setting-row studio-open-row appearance-section' }, h('div', { class: 'setting-text' }, h('span', { class: 'setting-label' }, t('studio.title')), h('span', { class: 'setting-hint' }, t('studio.open-hint'))), studio),
    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.appearance.colours')),
    coloursSection(redraw),
    ...menuSection(),

    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.appearance.backgrounds')),
    lookRow(GLOW),
    ...heroRows(a),
    row(
      t('settings.appearance.hero-count'),
      t('settings.appearance.hero-count-hint'),
      choices(t('settings.appearance.hero-count'), HERO_COUNTS.map((n) => [n, new Intl.NumberFormat(locale()).format(n)] as const), a.heroCount, (heroCount) => set({ heroCount })),
    ),
    wallpaperRow(),

    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.appearance.title-pages')),
    row(
      t('showcase.setting.label'),
      t('showcase.setting.hint'),
      choices(
        t('showcase.setting.label'),
        [
          ['classic', t('showcase.setting.classic')],
          ['showcase', t('showcase.setting.showcase')],
        ] as const,
        a.detailLayout,
        (detailLayout) => set({ detailLayout }),
      ),
    ),
    lookRow(DETAIL_BACKGROUND),
    logosRow(a.logos),
    qualityBadgesRow(a.qualityBadges),
    ageRatingsRow(a.ageRatings),
    whereToWatchRow(a.whereToWatch),

    h('h3', { class: 'settings-subheading appearance-section' }, t('settings.appearance.posters')),
    h(
      'div',
      { class: 'poster-settings' },
      h(
        'div',
        {},
        row(
          t('settings.appearance.card-shape'),
          t('settings.appearance.card-shape-hint'),
          choices(
            t('settings.appearance.card-shape'),
            [
              ['poster', t('settings.appearance.card-shape-portrait')],
              ['landscape', t('settings.appearance.card-shape-landscape')],
            ] as const,
            a.rowStyle,
            (rowStyle) => set({ rowStyle }),
          ),
        ),
        lookRow(POSTER_SIZE, t('settings.common.size')),
        lookRow(CORNERS),
        hoverInfoRow(),
        switchRow('cardTitles', a.cardTitles, 'pages.cards.titles', 'pages.cards.titles-hint'),
        switchRow('cardActions', a.cardActions, 'pages.cards.actions', 'pages.cards.actions-hint'),
        ...posterRows(),
      ),
      preview,
    ),

    ...extrasSection(),
    ...ambientSection(),
  ];
}

const MENU_NAMES: Record<NavPosition, MessageKey> = { top: 'studio.layout.top', sidebar: 'studio.layout.sidebar', rail: 'studio.layout.rail', dock: 'studio.layout.dock', cinematic: 'studio.layout.cinematic', arc: 'orbitlook.nav' };

/**
 * Where the menu lives, and where the floating pill sits when it's that
 * (Theme Studio → Layout has the same), then a link to the Studio for the
 * menu's pages, side and alignment. Saved as the nav layout, so the Studio
 * and Looks see the change.
 */
function menuSection(): HTMLElement[] {
  const save = (patch: Partial<NavLayout>) => void setNavLayout({ ...currentNavLayout(), ...patch }).catch(failed);
  const place = row(t('studio.layout.place'), t('studio.layout.place-hint'), pillPlacePicker(currentNavLayout().place, (next) => save({ place: next })));
  const style = choices(
    t('studio.layout.position'),
    NAV_POSITIONS.map((position) => [position, t(MENU_NAMES[position])] as const),
    currentNavLayout().position,
    (position) => {
      save({ position });
      showDependents(styleRow, [place], position === 'dock');
    },
  );
  const styleRow = row(t('studio.layout.position'), t('studio.layout.style-hint'), style);
  showDependents(styleRow, [place], currentNavLayout().position === 'dock');
  return [h('h3', { class: 'settings-subheading appearance-section' }, t('studio.layout.menu')), styleRow, place, studioLink(t('settings.appearance.menu-pages'), t('settings.appearance.menu-pages-hint'), 'layout')];
}

/** Choose or remove a wallpaper image, and how dimmed it is. */
function wallpaperRow(): HTMLElement {
  const control = h('div', { class: 'wallpaper-control' });
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_WALLPAPER_BYTES) return toast(t('settings.appearance.wallpaper-too-large'));
    setWallpaper(file)
      .then(draw)
      .catch((err: unknown) => toast(errorText(err)));
  });

  function draw(): void {
    // Redrawn after choosing or removing a wallpaper, the button pressed is gone: Choose (or Change) is in either state, so it keeps the keyboard focus.
    const focused = control.contains(document.activeElement);
    const choose = h('button', { class: 'button' }, hasWallpaper() ? t('settings.appearance.wallpaper-change') : t('settings.appearance.wallpaper-choose'));
    choose.addEventListener('click', () => input.click());
    if (focused) queueMicrotask(() => choose.focus({ preventScroll: true }));
    if (!hasWallpaper()) return void control.replaceChildren(choose, input);
    const remove = h('button', { class: 'button danger' }, t('settings.appearance.wallpaper-remove'));
    remove.addEventListener('click', () => void clearWallpaper().then(draw).catch(failed));
    const dim = choices(
      t('settings.appearance.wallpaper-dim'),
      [
        ['light', t('settings.appearance.wallpaper-light')],
        ['medium', t('settings.appearance.wallpaper-medium')],
        ['heavy', t('settings.appearance.wallpaper-heavy')],
      ] as const,
      appearance().wallpaperDim,
      (wallpaperDim) => set({ wallpaperDim }),
    );
    control.replaceChildren(dim, choose, remove, input);
  }
  draw();
  return row(t('settings.appearance.wallpaper'), t('settings.appearance.wallpaper-hint'), control);
}

/** What Auto decided on this device, and why (see theme/auto-effects.ts). */
function autoEffectsLine(): string {
  const reason = autoReason();
  if (!reason) return t('movix.effects.auto-off');
  switch (reason.kind) {
    case 'tv':
      return t('movix.effects.auto-tv');
    case 'cores':
      return tn('movix.effects.auto-cores', reason.count);
    case 'memory':
      return t('movix.effects.auto-memory', { memory: new Intl.NumberFormat(locale(), { style: 'unit', unit: 'gigabyte', unitDisplay: 'short', maximumFractionDigits: 2 }).format(reason.gigabytes) });
    case 'frames':
      return tn('movix.effects.auto-frames', reason.fps);
  }
}

/** Reduce visual effects: no blurs, glows or heavy shadows (lighter on the graphics card). Off, Auto (with why it's on or off) or On. */
function effectsRow(effects: Appearance['effects']): HTMLElement {
  const reasonLine = h('span', { class: 'setting-hint effects-reason', id: 'effects-auto-reason' });
  const showReason = (value: Appearance['effects']) => {
    reasonLine.hidden = value !== 'auto';
    reasonLine.textContent = autoEffectsLine();
  };
  const control = choices<Appearance['effects']>(
    t('settings.appearance.effects'),
    [
      ['full', t('settings.common.off')],
      ['auto', t('settings.common.auto')],
      ['reduced', t('settings.common.on')],
    ],
    effects,
    (value) => {
      showReason(value);
      set({ effects: value });
    },
  );
  const element = row(t('settings.appearance.effects'), t('settings.appearance.effects-hint'), control);
  element.querySelector('.setting-text')?.append(reasonLine);
  control.setAttribute('aria-describedby', `${control.getAttribute('aria-describedby') ?? ''} effects-auto-reason`.trim());
  showReason(effects);
  // The frame rate measured after startup can turn Auto on while the page is open.
  // Not `isConnected`: the page is detached while another category or room shows, and kept.
  whileOnPage(element, AUTO_EFFECTS_CHANGED, () => showReason(appearance().effects));
  return element;
}

/** A title's logo artwork instead of its name, in banners and on its page (stored with the rest of `appearance`). */
/** Home banner, and "Rows overlap the banner" under it while the banner is the cinematic one (the only one it changes). */
function heroRows(a: Appearance): HTMLElement[] {
  const toggle = createSwitch('', a.heroOverlap, (heroOverlap) => set({ heroOverlap }));
  toggle.setAttribute('aria-label', t('settings.appearance.hero-overlap'));
  const overlap = row(t('settings.appearance.hero-overlap'), t('settings.appearance.hero-overlap-hint'), toggle);
  const style = row(
    t(HERO_STYLE.label),
    t(HERO_STYLE.hint),
    choices(t(HERO_STYLE.label), optionsOf(HERO_STYLE), a.heroStyle, (heroStyle) => {
      set({ heroStyle });
      showDependents(style, [overlap], heroStyle === 'cinematic');
    }),
  );
  showDependents(style, [overlap], a.heroStyle === 'cinematic');
  return [style, overlap];
}

function logosRow(on: boolean): HTMLElement {
  const toggle = createSwitch('', on, (value) => set({ logos: value }));
  toggle.setAttribute('aria-label', t('settings.library.logos'));
  return row(t('settings.library.logos'), t('settings.library.logos-hint'), toggle);
}

/** 4K, HDR, Atmos… on title pages (rooms/detail/quality.ts). Off also stops a title page asking for its sources before Play. */
/** A switch for one of the appearance settings, saved at once. */
function switchRow(field: 'cardActions' | 'cardTitles', on: boolean, label: MessageKey, hint: MessageKey): HTMLElement {
  const toggle = createSwitch('', on, (value) => set({ [field]: value }));
  toggle.setAttribute('aria-label', t(label));
  return row(t(label), t(hint), toggle);
}

function qualityBadgesRow(on: boolean): HTMLElement {
  const toggle = createSwitch('', on, (value) => set({ qualityBadges: value }));
  toggle.setAttribute('aria-label', t('settings.appearance.quality-badges'));
  return row(t('settings.appearance.quality-badges'), t('settings.appearance.quality-badges-hint'), toggle);
}

function whereToWatchRow(on: boolean): HTMLElement {
  const toggle = createSwitch('', on, (value) => set({ whereToWatch: value }));
  toggle.setAttribute('aria-label', t('settings.appearance.where-to-watch'));
  return row(t('settings.appearance.where-to-watch'), t('settings.appearance.where-to-watch-hint'), toggle);
}

/** PG-13, TV-MA, 12… beside the year (components/age-rating.ts). Applies to what's drawn next. */
function ageRatingsRow(on: boolean): HTMLElement {
  const toggle = createSwitch('', on, (value) => set({ ageRatings: value }));
  toggle.setAttribute('aria-label', t('settings.appearance.age-ratings'));
  return row(t('settings.appearance.age-ratings'), t('settings.appearance.age-ratings-hint'), toggle);
}

/** Details beside a poster the mouse rests on (components/hover-info.ts). */
function hoverInfoRow(): HTMLElement {
  const control = h('span', {});
  void settings
    .get(HOVER_INFO_KEY)
    .catch(() => null)
    .then((saved) => {
      const toggle = createSwitch('', saved !== false, (on) => {
        setHoverInfo(on);
        void settings.set(HOVER_INFO_KEY, on).catch(failed);
      });
      toggle.setAttribute('aria-label', t('settings.appearance.hover-info'));
      control.replaceChildren(toggle);
    });
  return row(t('settings.appearance.hover-info'), t('settings.appearance.hover-info-hint'), control);
}

/** Little extras (lib/fun.ts): the launch ident, roulette, quips, search hints, seasonal glyph and joke languages, each on its own switch. */
function extrasSection(): HTMLElement[] {
  const prefs = funPrefs();
  const item = (key: keyof FunPrefs, label: string, hint: string) => {
    const toggle = createSwitch('', prefs[key], (on) => void setFun({ [key]: on }).catch(failed));
    toggle.setAttribute('aria-label', label);
    return row(label, hint, toggle);
  };
  return [
    h('h3', { class: 'settings-subheading appearance-section' }, t('fun.settings.heading')),
    item('intro', t('fun.settings.intro'), t('fun.settings.intro-hint')),
    item('roulette', t('fun.settings.roulette'), t('fun.settings.roulette-hint')),
    item('quips', t('fun.settings.quips'), t('fun.settings.quips-hint')),
    item('hints', t('fun.settings.hints'), t('fun.settings.hints-hint')),
    item('seasonal', t('fun.settings.seasonal'), t('fun.settings.seasonal-hint')),
    item('languages', t('funlangs.setting'), t('funlangs.setting-hint')),
  ];
}

/** Ambient mode: when it starts, then (only when it starts at all) what it shows and the clock, and a preview. */
function ambientSection(): HTMLElement[] {
  const prefs = ambientPrefs();
  const setAmbient = (patch: Partial<AmbientPrefs>) => void setAmbientPrefs(patch).catch(failed);
  const minutes = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(n);
  const toggle = (label: string, on: boolean, change: (on: boolean) => void) => {
    const control = createSwitch('', on, change);
    control.setAttribute('aria-label', label);
    return control;
  };
  const preview = h('button', { class: 'button' }, t('ambient.settings.preview'));
  preview.addEventListener('click', previewAmbient);
  const after = row(
    t('ambient.settings.after'),
    t('ambient.settings.after-hint'),
    choices(
      t('ambient.settings.after'),
      AMBIENT_AFTER_CHOICES.map((n) => [n, n === 0 ? t('settings.common.off') : minutes(n)] as const),
      prefs.afterMinutes,
      (afterMinutes) => {
        showDependents(after, followUps, ambientFollowUpsShown({ afterMinutes }));
        setAmbient({ afterMinutes });
      },
    ),
  );
  const followUps = [
    row(
      t('ambient.settings.source'),
      t('ambient.settings.source-hint'),
      choices(
        t('ambient.settings.source'),
        [
          ['for-you', t('ambient.settings.source-for-you')],
          ['trending', t('ambient.settings.source-trending')],
          ['both', t('ambient.settings.source-both')],
        ] as const,
        prefs.source,
        (source) => setAmbient({ source }),
      ),
    ),
    row(t('ambient.settings.clock'), t('ambient.settings.clock-hint'), toggle(t('ambient.settings.clock'), prefs.clock, (clock) => setAmbient({ clock }))),
    row(t('ambient.settings.paused'), t('ambient.settings.paused-hint'), toggle(t('ambient.settings.paused'), prefs.paused, (paused) => setAmbient({ paused }))),
  ];
  showDependents(after, followUps, ambientFollowUpsShown(prefs));
  // The preview stays, so it can be seen before turning it on.
  return [h('h3', { class: 'settings-subheading appearance-section' }, t('ambient.settings.heading')), after, ...followUps, row(t('ambient.settings.preview-label'), t('ambient.settings.preview-hint'), preview)];
}
