import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What's saved, as Rust would answer `settings_get`; nothing by default (a fresh install). */
let saved: Record<string, unknown> = {};
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { key?: string }) => {
    if (cmd === 'settings_get') return saved[args?.key ?? ''] ?? null;
    if (cmd === 'profiles_active') return null;
    return null;
  },
}));

// The modules behind the stores draw a toast region when loaded; there's no page here.
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../components/hover-info', () => ({ HOVER_INFO_KEY: 'browse.hover-info', setHoverInfo: () => {} }));

const { affects, changedLabels, changedRows, isChanged, PREFS, sameValue } = await import('./defaults');
const { advancedEntries, SETTINGS_ENTRIES } = await import('../../app/palette/settings-index');
const { CATEGORIES } = await import('./categories');

beforeEach(() => {
  saved = {};
});

describe('"Changed" detection', () => {
  it('compares settings by value, not by identity or key order', () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(isChanged('1080p', '1080p')).toBe(false);
    expect(isChanged(null, 0)).toBe(true);
  });

  it('lists the rows whose value differs from their default', () => {
    const prefs = [
      { label: 'settings.playback.countdown' as const, initial: 10 },
      { label: 'settings.video.hdr' as const, initial: false },
    ];
    expect([...changedLabels(prefs, [15, false])]).toEqual(['settings.playback.countdown']);
    expect([...changedLabels(prefs, [10, false])]).toEqual([]);
  });

  it('matches a per-profile setting by its prefix', () => {
    expect(affects({ keys: ['playback.autoplay-limits'] }, 'playback.autoplay-limits.p1')).toBe(true);
    expect(affects({ keys: ['playback.autoplay-limits'] }, 'playback.autoplay-limits')).toBe(true);
    expect(affects({ keys: ['playback.autoplay'] }, 'playback.autoplay-limit')).toBe(false);
  });

  it('marks nothing changed on a fresh install', async () => {
    for (const c of CATEGORIES) expect([...(await changedRows(c.id))], c.id).toEqual([]);
  });

  it('marks a row changed as its page would read it (older formats count as what they mean)', async () => {
    saved = { 'playback.next-up-countdown': 15, 'playback.autoplay': true, 'video.hwdec': 'off', 'playback.source-rules': { avoid: [], prefer: ['multi-audio'] } };
    expect(await changedRows('playback')).toEqual(new Set(['settings.playback.countdown']));
    expect(await changedRows('picture-sound')).toEqual(new Set(['settings.video.hwdec']));
    // Avoiding nothing differs from the default (cam); multi-audio is its own row, the Prefer chips stay at none.
    expect(await changedRows('addons')).toEqual(new Set(['settings.playback.avoid', 'settings.playback.multi-audio']));
    saved = { 'playback.autoplay': false };
    expect(await changedRows('playback')).toEqual(new Set(['settings.playback.autoplay']));
  });
});

describe('defaults registry', () => {
  it('belongs to rows the page draws in the same category', () => {
    // Simple rows named more clearly for the reset list ("Poster size", not the row's "Size").
    const NAMED_ONLY = new Set(['settings.appearance.poster-size-label', 'playerlook.presets-label']);
    for (const [category, prefs] of Object.entries(PREFS)) {
      for (const pref of prefs) expect(SETTINGS_ENTRIES.some((e) => e.category === category && e.label === pref.label) || NAMED_ONLY.has(pref.label), `${category}: ${pref.label}`).toBe(true);
    }
  });

  it('can tell whether each advanced preference row is changed', () => {
    // Rows that are actions or sections without one value (Dashboard, Your themes, a preview, diagnostics…) are the exceptions.
    const actions = new Set(['integrations.import.heading', 'settings.advanced.diagnostics', 'settings.themes.yours', 'settings.themes.fonts', 'studio.layout.place', 'ambient.settings.preview-label', 'studio.seek.heading', 'homerows.preset.dashboard', 'playerplus.settings.forget-skips']);
    for (const c of CATEGORIES) {
      for (const e of advancedEntries(c.id)) if (!actions.has(e.label)) expect(PREFS[c.id]?.some((p) => p.label === e.label), `${c.id}: ${e.label}`).toBe(true);
    }
  });

  it('resets the poster rows with the rest of Appearance (never the RPDB key)', () => {
    const appearance = PREFS.appearance!.map((p) => p.label);
    for (const label of ['posters.ratings', 'posters.provider', 'posters.rpdb.style']) expect(appearance, label).toContain(label);
    expect(appearance).not.toContain('posters.rpdb.key');
  });

  it('never resets accounts, sources, Home rows or the external player', () => {
    expect(PREFS.shortcuts).toBeUndefined();
    const resettable = Object.values(PREFS).flatMap((prefs) => prefs.filter((p) => p.reset).flatMap((p) => p.keys));
    for (const key of resettable) expect(key).not.toMatch(/^(stremio|jellyfin|plex|letterboxd|tmdb|cloud|addons|iptv|live\.sources|home\.layout|player\.external|downloads\.folder|profiles|history|library\.entries)/);
    const noReset = (category: string, label: string) => expect(PREFS[category]!.find((p) => p.label === label)?.reset, label).toBeUndefined();
    noReset('playback', 'local.external.heading');
    noReset('home-library', 'homerows.hero-next');
    noReset('home-library', 'homerows.greeting.label');
    noReset('appearance', 'playerlook.background');
  });
});
