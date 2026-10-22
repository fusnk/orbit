/**
 * Saved settings can come from a hand-edited backup (Settings → Advanced →
 * Restore), so every reader must fall back to its defaults on junk instead
 * of throwing or passing it through.
 */
import { describe, expect, it } from 'vitest';
import { parseRegion, parseServices } from './catalog/streaming';
import { parseContinueDays, parseWatchedAt } from './library/watch';
import { parseQuality, parseTorrentMode } from './rooms/detail/ranking-prefs';
import { parseTrailerDelay, trailerDelayMs, trailerSound } from './rooms/detail/trailer-settings';
import { parseLayout, parseRowPrefs } from './rooms/home/rows';
import { parseFit } from './rooms/player/panels';
import { DEFAULT_LAYOUT, parsePlayerLayout } from './rooms/player/layout';
import { countdownSeconds, parseVolume } from './rooms/player/next-up';
import { parseSeekStep } from './rooms/player/player-settings';
import { audioLanguages, availableLanguage, LANGUAGE_CHOICES, mpvLanguages, parseLanguage, parseLanguages } from './rooms/player/preferred-language';
import { DEFAULT_SUBTITLE_STYLE, parseSubtitleStyle } from './rooms/player/subtitle-style';
import { parseAppearance } from './theme/appearance';
import { isThemeId } from './theme/engine';

/** Values a backup file could hold where an object or list was expected. */
const JUNK: unknown[] = [null, undefined, 0, -1, 1e308, Number.NaN, '', 'junk', true, [], [1, 'a', null], {}, { a: { b: { c: 1 } } }, JSON.parse('{"__proto__": {"tint": true}}')];

describe('settings readers fall back on junk', () => {
  it('appearance', () => {
    const defaults = parseAppearance(null);
    for (const junk of JUNK) expect(parseAppearance(junk)).toEqual(defaults);
    // Field by field: bad values reset, good ones stay.
    expect(parseAppearance({ glow: 'blinding', posterSize: 'large', scale: 999, corners: 7, spoilers: 'no', tint: 'yes' })).toEqual({ ...defaults, posterSize: 'large' });
    // Auto out of the box; a saved Off (from before Auto) stays Off.
    expect(defaults.effects).toBe('auto');
    expect(parseAppearance({ effects: 'full' }).effects).toBe('full');
    expect(parseAppearance({ effects: 'reduced' }).effects).toBe('reduced');
    expect(parseAppearance({ effects: 'none' }).effects).toBe('auto');
    expect(defaults.heroStyle).toBe('card');
    expect(parseAppearance({ heroStyle: 'spotlight' }).heroStyle).toBe('spotlight');
    expect(parseAppearance({ heroStyle: 'billboard' }).heroStyle).toBe('card');
    // Saved before the banner's count was a choice: the five it always showed.
    expect(defaults.heroCount).toBe(5);
    expect(parseAppearance({ heroCount: 7 }).heroCount).toBe(7);
    for (const odd of [3, 8, '6', 5.5]) expect(parseAppearance({ heroCount: odd }).heroCount).toBe(5);
    // Card shape keeps the old "Default row style" field, so a saved Landscape carries over.
    expect(defaults.rowStyle).toBe('poster');
    expect(parseAppearance({ rowStyle: 'landscape' }).rowStyle).toBe('landscape');
    for (const odd of ['top10', 'portrait', 'square', 1]) expect(parseAppearance({ rowStyle: odd }).rowStyle).toBe('poster');
  });

  it('subtitle style', () => {
    for (const junk of JUNK) expect(parseSubtitleStyle(junk)).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(parseSubtitleStyle({ size: 9000, color: 'red; background: url(x)', background: 'box', outline: -3, position: '100', bold: 1 })).toEqual({ ...DEFAULT_SUBTITLE_STYLE, background: 'box' });
  });

  it('home rows', () => {
    for (const junk of JUNK) expect(parseRowPrefs(junk)).toEqual({ order: [], hidden: [] });
    expect(parseRowPrefs({ order: ['a', 2, null, 'b'], hidden: 'a' })).toEqual({ order: ['a', 'b'], hidden: [] });
  });

  it('Home layout (added rows and styles)', () => {
    for (const junk of JUNK) expect(parseLayout(junk)).toEqual({ order: [], hidden: [], styles: {}, added: [] });
    // Row by row: a bad added row or style is dropped, the rest stay.
    expect(
      parseLayout({
        order: ['row-a', 5],
        styles: { 'row-a': 'top10', 'row-b': 'huge', __proto__: 'poster' },
        added: [{ id: 'row-a', source: { kind: 'mood', mood: 'late-night' } }, { id: 'row-b', source: { kind: 'catalog', addon: 'x' } }, 'junk', null],
      }),
    ).toEqual({ order: ['row-a'], hidden: [], styles: { 'row-a': 'top10' }, added: [{ id: 'row-a', source: { kind: 'mood', mood: 'late-night' } }] });
  });

  it('streaming services and country', () => {
    for (const junk of JUNK) {
      // Only well-formed keys survive; unknown ones then match no service.
      expect(parseServices(junk).every((key) => /^[a-z]{1,20}$/.test(key))).toBe(true);
      expect(parseRegion(junk)).toBeNull();
    }
    expect(parseServices(['netflix', 'Netflix', '../x', 7, 'disney'])).toEqual(['netflix', 'disney']);
    expect(parseRegion('GB')).toBe('GB');
    expect(parseRegion('gb')).toBeNull();
  });

  it('watched threshold and Continue Watching days', () => {
    for (const junk of JUNK) {
      expect(parseWatchedAt(junk)).toBe(0.9);
      // 0 is a real choice (Never).
      if (junk !== 0) expect(parseContinueDays(junk)).toBe(30);
    }
    expect(parseWatchedAt(0.8)).toBe(0.8);
    expect(parseWatchedAt(0.5)).toBe(0.9);
    expect(parseContinueDays(0)).toBe(0);
    expect(parseContinueDays(365)).toBe(30);
  });

  it('preferred languages and quality', () => {
    for (const junk of JUNK) {
      expect(parseQuality(junk)).toBe('1080p');
      expect(parseTorrentMode(junk)).toBe('off');
      expect(parseFit(junk)).toBe('fit');
      expect(parseLanguage(junk)).toBe('');
      expect(mpvLanguages(junk as string)).toBe('');
    }
    expect(parseLanguage('toString')).toBe('');
    expect(mpvLanguages('fr')).toBe('fr,fre,fra');
    for (const junk of JUNK) expect(parseLanguages(junk)).toEqual([]);
  });

  it('regional languages reach mpv in the shape Rust accepts', () => {
    // Rust's check_languages: lowercase "xx"/"xxx" with an optional "-region", at most 256 bytes.
    const shape = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;
    for (const key of LANGUAGE_CHOICES) for (const code of mpvLanguages(key).split(',')) expect(code).toMatch(shape);
    expect(mpvLanguages('zh-Hant')).toBe('zh-hant,zh-tw,zh-hk,zht,zh,chi,zho');
    const longest = [...LANGUAGE_CHOICES].sort((a, b) => mpvLanguages(b).length - mpvLanguages(a).length).slice(0, 5);
    expect(mpvLanguages(longest).length).toBeLessThanOrEqual(256);
  });

  it('original language first: the title’s own language, then the chosen one', () => {
    expect(audioLanguages('ja', 'en')).toBe('ja,jpn,en,eng');
    expect(audioLanguages('ko', '')).toBe('ko,kor');
    // Already the chosen language: once.
    expect(audioLanguages('en', 'en')).toBe('en,eng');
    // A language Orbit doesn't list goes as TMDB gives it; TMDB's "cn" is Cantonese.
    expect(audioLanguages('ta', 'en')).toBe('ta,en,eng');
    expect(audioLanguages('cn', '')).toBe('yue,zh,chi,zho');
    // Unknown, or not a language code: just the chosen one.
    expect(audioLanguages(null, 'fr')).toBe('fr,fre,fra');
    expect(audioLanguages('xx', 'fr')).toBe('fr,fre,fra');
    expect(audioLanguages('EN,eng', 'fr')).toBe('fr,fre,fra');
  });

  it('subtitle languages: a saved single key or an ordered list', () => {
    expect(parseLanguages('pt-BR')).toEqual(['pt-BR']);
    expect(parseLanguages(['zh-Hant', 'en', 'en', 'xx', 3])).toEqual(['zh-Hant', 'en']);
    expect(parseLanguages(['en', 'fr', 'de', 'es', 'it', 'nl'])).toHaveLength(5);
    expect(parseLanguage(['fr', 'en'])).toBe('fr');
    // mpv gets every code in order, once; Brazilian Portuguese falls back to any Portuguese.
    expect(mpvLanguages(['pt-BR', 'pt', 'en'])).toBe('pt-br,pob,pb,pt,por,en,eng');
    // The first language the video or an addon has subtitles in, else the first.
    expect(availableLanguage(['pt-BR', 'en'], (lang) => lang === 'en')).toBe('en');
    expect(availableLanguage(['pt-BR', 'en'], () => false)).toBe('pt-BR');
    expect(availableLanguage([], () => true)).toBe('');
    expect(parseQuality('2160p')).toBe('2160p');
    expect(parseFit('fill')).toBe('fill');
  });

  it('volume, countdown and theme', () => {
    for (const junk of JUNK) {
      expect(parseVolume(junk)).toBeNull();
      // 0 is a real choice (Off); anything else that isn't 5, 10 or 15 means the default.
      if (junk !== 0) expect(countdownSeconds(junk)).toBe(10);
      expect(isThemeId(junk)).toBe(false);
    }
    expect(parseVolume({ volume: 201, muted: true })).toBeNull();
    // Saved with a volume boost on; the player clamps it if that's lower or off now.
    expect(parseVolume({ volume: 150, muted: true })).toEqual({ volume: 150, muted: true });
    expect(parseVolume({ volume: 200, muted: false })).toEqual({ volume: 200, muted: false });
    expect(parseSeekStep(15)).toBe(15);
    for (const junk of [...JUNK, 7, '10', 300]) expect(parseSeekStep(junk)).toBe(10);
    expect(parseVolume({ volume: 40, muted: 'yes' })).toEqual({ volume: 40, muted: false });
    expect(isThemeId('black')).toBe(true);
  });

  it('player layout', () => {
    for (const junk of JUNK) expect(parsePlayerLayout(junk)).toEqual(DEFAULT_LAYOUT);
    // Field by field: bad values reset, good ones stay, unknown keys are dropped.
    expect(parsePlayerLayout({ preset: 'tv', size: 'huge', background: 'blur', timeline: 7, title: 'no', clock: true, extra: 'x' })).toEqual({ ...DEFAULT_LAYOUT, preset: 'tv', background: 'blur', clock: true });
  });

  it('trailer delay and sound', () => {
    // The default is what title pages always waited.
    for (const junk of [...JUNK, 2, '3', 1500]) expect(parseTrailerDelay(junk)).toBe(1.5);
    expect(parseTrailerDelay(3)).toBe(3);
    expect(parseTrailerDelay(5)).toBe(5);
    expect(trailerDelayMs(null)).toBe(1500);
    expect(trailerDelayMs(1.5)).toBe(1500);
    expect(trailerDelayMs(5)).toBe(5000);
    // Muted unless sound was chosen.
    for (const junk of JUNK.filter((value) => value !== true)) expect(trailerSound(junk)).toBe(false);
    expect(trailerSound('true')).toBe(false);
    expect(trailerSound(true)).toBe(true);
  });
});
