import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
vi.mock('../lib/ipc', () => ({
  settings: {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: unknown) => void saved.set(key, value),
  },
  withDialog: async () => null,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: async () => {} }) }));

const vars = new Map<string, string>();
const html = {
  dataset: {} as Record<string, string>,
  style: { setProperty: (k: string, v: string) => void vars.set(k, v), getPropertyValue: (k: string) => vars.get(k) ?? '', removeProperty: (k: string) => void vars.delete(k) },
};
vi.stubGlobal('document', { documentElement: html, dispatchEvent: () => true, addEventListener: () => {}, adoptedStyleSheets: [] });
vi.stubGlobal('CSSStyleSheet', class { cssRules: unknown[] = []; replaceSync() {} deleteRule() {} });

import type * as Engine from './engine';
// The first import transforms the whole module graph (i18n and every locale), which can take many
// seconds while the full suite runs. Done here, while the file loads, it isn't held to the hook
// timeout, and each test's fresh import below reuses the transformed modules.
await import('./engine');
let engine: typeof Engine;
beforeEach(async () => {
  saved.clear();
  vi.resetModules();
  engine = await import('./engine');
});

const file = (name: string, accent: string) =>
  JSON.stringify({ orbitTheme: 1, name, fonts: 'orbit', colors: { bg: '#000000', panel: '#111111', raised: '#222222', text: '#ffffff', muted: '#aaaaaa', faint: '#777777', danger: '#ff0000', accent }, css: `.${name} { color: red; }` });

describe('Theme Studio save', () => {
  it('goes into the theme it opened on, even after another was chosen', async () => {
    const a = await engine.importTheme(file('Alpha', '#00ff00'));
    // The Studio opens on Alpha: its draft is a snapshot.
    const opened = engine.currentThemeId();
    const draft = { ...engine.currentLook(), name: 'Alpha edited' };
    const b = await engine.importTheme(file('Beta', '#0000ff'));
    // Beta is picked in Settings → Appearance with the Studio still open, then Save is pressed in the Studio.
    await engine.chooseTheme(b.id);
    const into = await engine.saveLook(draft, opened);
    const themes = engine.myThemes();
    const beta = themes.find((t) => t.id === b.id)!;
    const alpha = themes.find((t) => t.id === a.id)!;
    expect({ into: into.id, beta: beta.name, betaAccent: beta.colors.accent, betaCss: saved.get(`theme.css.${b.id}`), alpha: alpha.name }).toEqual({
      into: a.id,
      beta: 'Beta',
      betaAccent: '#0000ff',
      betaCss: '.Beta { color: red; }',
      alpha: 'Alpha edited',
    });
    // What was saved is what's on.
    expect(engine.currentThemeId()).toBe(a.id);
    expect(saved.get('theme')).toBe(a.id);
  });

  it('makes a new theme when the one it opened on was deleted meanwhile', async () => {
    const a = await engine.importTheme(file('Alpha', '#00ff00'));
    const draft = { ...engine.currentLook(), name: 'Alpha edited' };
    await engine.deleteTheme(a.id);
    const into = await engine.saveLook(draft, a.id);
    expect(into.id).not.toBe(a.id);
    expect(engine.myThemes().map((t) => t.name)).toEqual(['Alpha edited']);
  });

  it('leaves nothing saved when the save is refused (30 themes already)', async () => {
    for (let i = 0; i < 30; i++) await engine.importTheme(file(`T${i}`, '#00ff00'));
    await engine.chooseTheme('nord');
    const before = { css: saved.get('theme.css'), fonts: saved.get('theme.fonts'), layout: saved.get('theme.layout') };
    const draft = { ...engine.currentLook(), css: '.x { color: red; }', fonts: 'plex' as never, layout: { ...engine.currentLook().layout, position: 'rail' as never } };
    await expect(engine.saveLook(draft)).rejects.toThrow();
    // "Discard" in the Studio then: the next start should show what was saved before.
    expect({ css: saved.get('theme.css'), fonts: saved.get('theme.fonts'), layout: saved.get('theme.layout') }).toEqual(before);
  });
});

describe('custom CSS safe mode (Shift at startup)', () => {
  it('takes custom CSS off for the session, until the Studio saves some by hand', async () => {
    const { currentCss } = await import('./custom-css');
    // Nothing showing: nothing to turn off.
    expect(engine.startCssSafeMode()).toBe(false);
    const a = await engine.importTheme(file('Alpha', '#00ff00'));
    expect(currentCss()).toBe('.Alpha { color: red; }');
    expect(engine.startCssSafeMode()).toBe(true);
    expect(currentCss()).toBe('');
    // Choosing a theme with CSS, or loading the saved one again, doesn't bring it back...
    await engine.importTheme(file('Beta', '#0000ff'));
    await engine.chooseTheme(a.id);
    await engine.loadTheme();
    expect(currentCss()).toBe('');
    // ...but it's still saved for the next start.
    expect(saved.get('theme.css')).toBe('.Alpha { color: red; }');
    await engine.saveLook({ ...engine.currentLook(), css: '.fixed { color: blue; }' });
    expect(currentCss()).toBe('.fixed { color: blue; }');
  });

  it('keeps the CSS it hid when the Studio saves other changes', async () => {
    const { currentCss } = await import('./custom-css');
    const a = await engine.importTheme(file('Alpha', '#00ff00'));
    expect(engine.startCssSafeMode()).toBe(true);
    // The Studio opens on what's saved, CSS included, without showing that CSS again.
    const draft = engine.currentLook();
    expect(draft.css).toBe('.Alpha { color: red; }');
    engine.previewLook(draft);
    expect(currentCss()).toBe('');
    // Only the name changes.
    await engine.saveLook({ ...draft, name: 'Alpha renamed' });
    expect(saved.get(`theme.css.${a.id}`)).toBe('.Alpha { color: red; }');
    expect(saved.get('theme.css')).toBe('.Alpha { color: red; }');
    expect(currentCss()).toBe('');
    expect(engine.currentLook().css).toBe('.Alpha { color: red; }');
    // Editing it in the Code tab shows the edit; undoing hides the saved CSS again.
    engine.previewLook({ ...draft, css: '.Alpha { color: blue; }' });
    expect(currentCss()).toBe('.Alpha { color: blue; }');
    engine.previewLook(draft);
    expect(currentCss()).toBe('');
  });
});

describe('Studio export → import round trip', () => {
  it('keeps every part', async () => {
    const { themeFile, parseThemeFile } = await import('./palette');
    const look = engine.currentLook();
    const data = {
      name: 'Ünïcødé 🎬 theme',
      tagline: 'A tagline',
      colors: look.colors,
      fonts: 'plex' as const,
      layout: { position: 'dock' as const, side: 'end' as const, align: 'start' as const, place: 'top' as const, items: [{ id: 'home', label: 'Start 🏠', hidden: false }, { id: 'movies', label: null, hidden: true }] },
      seekbar: { style: 'glass' as const, height: 6, color: '#ff4d6d', barImage: null, buffered: false, bufferedBrightness: 40, dot: 'square' as const, dotSize: 20, dotImage: null },
      css: '.a { color: red; }\n/* ü */',
      style: 'afterglow' as const,
    };
    const back = parseThemeFile(themeFile(data as never));
    expect(back).toEqual(data);
  });
});

describe('Theme Studio discard', () => {
  it('shows what Settings saved meanwhile when its edit is thrown away', async () => {
    await engine.chooseTheme('nord');
    const { setAppearance } = await import('./appearance');
    // The Studio opens: its snapshot. An edit in it is previewed.
    const opened = engine.currentLook();
    engine.previewLook({ ...opened, appearance: { ...opened.appearance, glow: 'strong' } });
    // With the Studio still open, the accent, glow and menu are changed in Settings.
    await engine.setAccent('#00ff00');
    await setAppearance({ glow: 'off' });
    await engine.setNavLayout({ ...opened.layout, position: 'rail' });
    // Discard.
    engine.showSavedLook(opened.css);
    expect({ accent: vars.get('--color-accent'), glow: vars.get('--ambient-strength'), nav: html.dataset.nav }).toEqual({ accent: '#00ff00', glow: '0', nav: 'rail' });
  });
});
