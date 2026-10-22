import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
import type { MessageKey } from '../../i18n';
import { ar } from '../../i18n/locales/ar';
import { cs } from '../../i18n/locales/cs';
import { de } from '../../i18n/locales/de';
import { en } from '../../i18n/locales/en';
import { es } from '../../i18n/locales/es';
import { fr } from '../../i18n/locales/fr';
import { he } from '../../i18n/locales/he';
import { it as italian } from '../../i18n/locales/it';
import { nl } from '../../i18n/locales/nl';
import { pl } from '../../i18n/locales/pl';
import { pt } from '../../i18n/locales/pt';
import { ja } from '../../i18n/locales/ja';
import { ko } from '../../i18n/locales/ko';
import { zh } from '../../i18n/locales/zh';
import { ru } from '../../i18n/locales/ru';
import { uk } from '../../i18n/locales/uk';
import { sv } from '../../i18n/locales/sv';
import { tr } from '../../i18n/locales/tr';
import { id } from '../../i18n/locales/id';
import settingsSource from '../../rooms/settings/index.ts?raw';
import { CATEGORIES } from '../../rooms/settings/categories';
import { LOOKS } from '../../theme/looks';
import { ACTION_IDS, assignKey, keymap, saveKeymap } from '../../lib/keymap';
import { advancedEntries, currentSettingId, SETTINGS_CATEGORIES, SETTINGS_ENTRIES, SHORTCUT_ENTRIES, SHORTCUT_ITEMS, shortcutDetail } from './settings-index';

/** The categories the Settings page draws, read from its source (importing it would draw every panel). */
const drawn = [...settingsSource.slice(settingsSource.indexOf('const CONTENT')).matchAll(/^ {2}'?([a-z-]+)'?: \(/gm)].map((m) => m[1]);

/** Every language Orbit ships. */
const CATALOGS = { en, es, fr, pt, de, it: italian, nl, pl, cs, ar, he, ja, ko, zh, ru, uk, sv, tr, id };

const categoryOf =(label: string) => SETTINGS_ENTRIES.filter((e) => e.label === label).map((e) => (e.tab ? `${e.category}/${e.tab}` : e.category));
const rows = (category: string) => SETTINGS_ENTRIES.filter((e) => e.category === category && e.find !== 'heading');

describe('settings index', () => {
  it('has every Settings category, in the page’s order, and the page draws each', () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual(CATEGORIES.map((c) => c.id));
    expect(drawn).toEqual(CATEGORIES.map((c) => c.id));
  });

  it('points every entry at a real category and tab, once', () => {
    for (const e of SETTINGS_ENTRIES) {
      const category = CATEGORIES.find((c) => c.id === e.category);
      expect(category, e.id).toBeDefined();
      if (e.tab) expect(category!.tabs?.map((t) => t.id), e.id).toContain(e.tab);
    }
    expect(new Set(SETTINGS_ENTRIES.map((e) => e.id)).size).toBe(SETTINGS_ENTRIES.length);
  });

  it('finds rows where they moved to (same setting keys, new categories)', () => {
    expect(categoryOf('settings.video.trailers')).toEqual(['playback']);
    expect(categoryOf('settings.playback.pause-minimized')).toEqual(['player']);
    expect(categoryOf('settings.player.seek-step')).toEqual(['player']);
    expect(categoryOf('settings.video.previews')).toEqual(['player']);
    expect(categoryOf('local.external.heading')).toEqual(['player']);
    expect(categoryOf('settings.library.logos')).toEqual(['appearance']);
    expect(categoryOf('playerlook.layout')).toEqual(['player']);
    expect(categoryOf('studio.seek.heading')).toEqual(['player']);
    expect(categoryOf('settings.appearance.scale')).toEqual(['general']);
    expect(categoryOf('alerts.settings.enabled')).toEqual(['general']);
    expect(categoryOf('settings.advanced.backup')).toEqual(['general']);
    expect(categoryOf('integrations.import.heading')).toEqual(['general']);
    expect(categoryOf('settings.playback.quality')).toEqual(['addons/sources']);
    expect(categoryOf('sources.limits.max-size')).toEqual(['addons/sources']);
    expect(categoryOf('settings.subtitles.audio-language')).toEqual(['picture-sound']);
    expect(categoryOf('settings.subtitles.subtitle-language')).toEqual(['subtitles']);
    expect(categoryOf('livetv.settings.open-on')).toEqual(['accounts']);
    expect(categoryOf('spoilers.scope')).toEqual(['home-library']);
  });

  it('has rows in every category, with labels and keywords in English', () => {
    for (const c of SETTINGS_CATEGORIES) {
      expect(rows(c.id).length + SETTINGS_ENTRIES.filter((e) => e.category === c.id).length, c.id).toBeGreaterThan(0);
      expect(en[c.keywords].trim()).not.toBe('');
    }
    for (const e of SETTINGS_ENTRIES) expect(en[e.label].trim()).not.toBe('');
  });

  it('finds first-run setup, AniList and the updates', () => {
    expect(categoryOf('onboard.settings.again')).toEqual(['general']);
    expect(categoryOf('settingshome.about.heading')).toEqual(['general']);
    expect(categoryOf('integrations.anilist.account')).toEqual(['accounts']);
  });

  it('finds every Look by its name', () => {
    const looks = SETTINGS_ENTRIES.filter((e) => e.find === '.looks-section').map((e) => en[e.label]);
    expect(looks).toEqual(LOOKS.map((look) => look.name));
  });
});

describe('editors that live in Theme Studio', () => {
  it('open the Studio at the right place, from a link row Settings still draws', () => {
    const studio = Object.fromEntries(SETTINGS_ENTRIES.filter((e) => e.studio).map((e) => [e.id, [e.tab, e.studio]]));
    expect(studio).toEqual({
      'appearance/studio.colours': [undefined, 'colours'],
      'appearance/settings.appearance.menu-pages': [undefined, 'layout'],
      'player/studio.seek.heading': [undefined, 'seekbar'],
    });
    // Never folded: a link is the only way to them from Settings.
    expect(SETTINGS_ENTRIES.filter((e) => e.studio && e.advanced)).toEqual([]);
  });

  it('keep the seek bar’s remembered pick', () => {
    expect(currentSettingId('player/studio.seek.heading')).toBe('player/studio.seek.heading');
    expect(currentSettingId('appearance/studio.seek.heading')).toBe('player/studio.seek.heading');
  });
});

describe('remembered picks', () => {
  it('lead to where categories and rows are now, or nowhere', () => {
    // Current ids stay as they are.
    expect(currentSettingId('playback')).toBe('playback');
    expect(currentSettingId('playback/settings.playback.countdown')).toBe('playback/settings.playback.countdown');
    // Categories from before the regrouping.
    expect(currentSettingId('video')).toBe('picture-sound');
    expect(currentSettingId('audio')).toBe('subtitles');
    expect(currentSettingId('player')).toBe('player');
    expect(currentSettingId('library')).toBe('home-library');
    expect(currentSettingId('integrations')).toBe('accounts');
    expect(currentSettingId('livetv')).toBe('accounts');
    expect(currentSettingId('advanced')).toBe('general');
    // Rows that moved keep their label key.
    expect(currentSettingId('library/settings.library.watched')).toBe('home-library/settings.library.watched');
    expect(currentSettingId('playback/settings.playback.quality')).toBe('addons/settings.playback.quality');
    expect(currentSettingId('player/settings.player.seek-step')).toBe('player/settings.player.seek-step');
    expect(currentSettingId('playback/settings.player.seek-step')).toBe('player/settings.player.seek-step');
    expect(currentSettingId('appearance/playerlook.size')).toBe('player/playerlook.size');
    expect(currentSettingId('advanced/settings.advanced.backup')).toBe('general/settings.advanced.backup');
    expect(currentSettingId('audio/settings.subtitles.audio-language')).toBe('picture-sound/settings.subtitles.audio-language');
    // Gone: quietly dropped.
    expect(currentSettingId('library/alerts.settings.heading')).toBeNull();
    expect(currentSettingId('nonsense')).toBeNull();
  });
});

describe('simple view (advanced rows)', () => {
  it('folds exactly these rows', () => {
    const folded = Object.fromEntries(CATEGORIES.map((c) => [c.id, advancedEntries(c.id).map((e) => e.label)]));
    expect(folded).toEqual({
      // General folds with its own "More …" groups (rooms/settings/disclosure.ts).
      general: [],
      appearance: [
        'settings.themes.yours',
        'settings.themes.tint',
        'settings.themes.fonts',
        'studio.layout.place',
        'settings.appearance.glow',
        'settings.appearance.hero-count',
        'settings.appearance.detail-background',
        'settings.appearance.quality-badges',
        'settings.appearance.age-ratings',
        'settings.appearance.where-to-watch',
        'settings.appearance.corners',
        'fun.settings.intro',
        'fun.settings.roulette',
        'fun.settings.quips',
        'fun.settings.hints',
        'fun.settings.seasonal',
        'funlangs.setting',
        'ambient.settings.source',
        'ambient.settings.clock',
        'ambient.settings.paused',
        'ambient.settings.preview-label',
      ],
      'home-library': ['titles.settings.story-arcs', 'settings.library.watched', 'spoilers.titles', 'spoilers.ratings', 'spoilers.unaired', 'spoilers.scope', 'homerows.preset.dashboard', 'homerows.hero-next', 'homerows.greeting.label', 'homerows.tags.label'],
      playback: [
        'settings.playback.resume-source',
        'watching.autoplay.limit',
        'settings.playback.countdown',
        'movix.next-up.when',
        'movix.next-up.amount',
        'movix.next-up.style',
        'settings.playback.same-source',
        'playerplus.settings.skip-recap',
        'playerplus.settings.skip-preview',
        'playerplus.settings.skip-delay',
        'movix.button-delay',
        'movix.landing',
        'movix.color-intro',
        'movix.color-recap',
        'movix.color-credits',
        'movix.color-preview',
        'settings.playback.skip-lookup',
        'movix.aniskip',
        'playerplus.settings.learn-skips',
        'playerplus.settings.forget-skips',
        'settings.video.banner-trailers',
        'settings.video.trailer-delay',
      ],
      // The player's look, then its controls, window and extras, and the external player.
      player: [
        'playerlook.background',
        'playerlook.timeline',
        'playerlook.show-title',
        'playerlook.show-badges',
        'playerlook.show-next',
        'playerlook.show-chapters',
        'playerplus.settings.episodes',
        'settings.player.volume-boost',
        'playerplus.settings.hold-boost',
        'playerplus.settings.number-jump',
        'pstream.settings.double-click',
        'settings.playback.volume-popup',
        'settings.playback.volume-popup-position',
        'settings.playback.pause-minimized',
        'settings.playback.keep-fullscreen',
        'playerplus.settings.grayscale',
        'settings.video.previews',
        'settings.player.rewind',
        'local.external.heading',
      ],
      subtitles: ['settings.subtitles.forced', 'settings.subtitles.auto-sync', 'subs.settings.keep-lyrics', 'playertools.caps.setting', 'subs.style.opacity', 'subs.style.box-colour', 'subs.style.box-opacity', 'settings.subtitles.outline', 'subs.style.outline-colour', 'settings.subtitles.bold'],
      'picture-sound': ['settings.video.picture', 'settings.video.hwdec', 'settings.video.hdr', 'settings.video.hdr-subtitles', 'settings.video.smooth-motion', 'settings.subtitles.passthrough', 'settings.subtitles.avoid'],
      addons: [
        'settings.playback.source-fails',
        'settings.playback.max-quality',
        'settings.playback.max-size',
        'sources.rules.min-size',
        'settings.playback.multi-audio',
        'settings.playback.avoid',
        'settings.playback.prefer',
        'settings.playback.prefer-words',
        'settings.playback.avoid-words',
        'sources.limits.min-quality',
        'sources.limits.max-quality',
        'sources.limits.max-size',
      ],
      accounts: [
        'integrations.discord.hide-title',
        'integrations.discord.poster',
        'integrations.discord.time',
        'integrations.discord.while-paused',
        'integrations.discord.while-browsing',
        'integrations.discord.hide-limited',
        'livetv.vod.sources',
        'livetv.settings.open-on',
        'livetv.settings.resume',
      ],
      downloads: ['downloads.settings.keep-next', 'downloads.schedule.speed', 'downloads.schedule.window'],
      shortcuts: [],
    });
  });

  it('keeps what everyone needs in the simple view', () => {
    const simple = ['settings.general.language', 'settings.appearance.scale', 'alerts.settings.enabled', 'settings.advanced.backup', 'settings.playback.play', 'settings.playback.autoplay', 'playerplus.settings.skip-intro', 'settings.video.trailers', 'settings.player.seek-step', 'settings.subtitles.subtitle-language', 'settings.video.quality', 'settings.subtitles.audio-language', 'settings.playback.quality', 'settings.playback.torrents', 'downloads.settings.quality'];
    for (const label of simple) expect(SETTINGS_ENTRIES.find((e) => e.label === label)?.advanced, label).toBe(false);
  });

  it('shows a newcomer well under half of the rows', () => {
    const all = SETTINGS_ENTRIES.filter((e) => e.find !== 'heading' && !e.label.startsWith('looks.name.'));
    const shown = all.filter((e) => !e.advanced).length / all.length;
    expect(shown).toBeGreaterThan(0.3);
    expect(shown).toBeLessThan(0.5);
  });

  it('never folds a heading, and folds rows it can find by an unambiguous label', () => {
    expect(SETTINGS_ENTRIES.filter((e) => e.advanced && e.find === 'heading')).toEqual([]);
    for (const c of CATEGORIES) {
      const labels = SETTINGS_ENTRIES.filter((e) => e.category === c.id && e.find === 'row').map((e) => en[e.label]);
      const folded = advancedEntries(c.id).filter((e) => e.find === 'row').map((e) => en[e.label]);
      for (const label of folded) expect(labels.filter((l) => l === label), `${c.id}: ${label}`).toHaveLength(1);
    }
  });

  it('names every row differently within its category, in every language (rows are found by their label)', () => {
    for (const [language, catalog] of Object.entries(CATALOGS)) {
      const named = (key: MessageKey) => (catalog as Partial<Record<string, string>>)[key] ?? en[key];
      for (const c of CATEGORIES) {
        const labels = SETTINGS_ENTRIES.filter((e) => e.category === c.id && e.find === 'row').map((e) => named(e.label));
        expect(labels.filter((label, i) => labels.indexOf(label) !== i), `${language}: ${c.id}`).toEqual([]);
      }
    }
  });
});

describe('keyboard shortcuts', () => {
  it('are all findable: the palette and the pages it already offers show their key, every other action is its own entry', () => {
    const found = [...SHORTCUT_ENTRIES.map((e) => e.id), ...Object.values(SHORTCUT_ITEMS)];
    expect(found.sort()).toEqual(ACTION_IDS.filter((id) => id !== 'app.palette').sort());
    for (const e of SHORTCUT_ENTRIES) expect(en[e.label].trim(), e.id).not.toBe('');
  });

  it('say the key each has now', async () => {
    expect(shortcutDetail('player.mute')).toBe('Shortcut · M');
    await saveKeymap(assignKey(keymap(), 'player.mute', 'U', 'replace'));
    expect(shortcutDetail('player.mute')).toBe('Shortcut · U');
    await saveKeymap({ ...keymap(), 'player.mute': [] });
    expect(shortcutDetail('player.mute')).toBe('Shortcut · No key');
  });
});
