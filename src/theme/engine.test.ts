import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePlayerLayout } from '../rooms/player/layout';

const saved = new Map<string, unknown>();
// A setting whose read waits, to let a test overlap two theme changes.
const gates = new Map<string, Promise<void>>();
vi.mock('../lib/ipc', () => ({
  settings: {
    get: async (key: string) => {
      await gates.get(key);
      return saved.get(key) ?? null;
    },
    set: async (key: string, value: unknown) => void saved.set(key, value),
  },
}));
// Commands sent to Rust, to see which seek-bar pictures are kept.
const invoked: [string, unknown][] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown) => {
    invoked.push([cmd, args]);
    return null;
  },
}));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: async () => {} }) }));

// Just enough of <html> for the theme and accent to be applied to.
const vars = new Map<string, string>();
const html = {
  dataset: {} as Record<string, string>,
  style: { setProperty: (k: string, v: string) => void vars.set(k, v), getPropertyValue: (k: string) => vars.get(k) ?? '', removeProperty: (k: string) => void vars.delete(k) },
};
// And of a constructable stylesheet, for custom CSS.
class FakeSheet {
  replaceSync() {}
  get cssRules() {
    return [];
  }
}
vi.stubGlobal('CSSStyleSheet', FakeSheet);
vi.stubGlobal('document', { documentElement: html, adoptedStyleSheets: [], dispatchEvent: () => true, addEventListener: () => {} });

import type * as Appearance from './appearance';
import type * as Css from './custom-css';
import type * as Engine from './engine';
import type * as Looks from './looks';

let engine: typeof Engine;
let looks: typeof Looks;
let appearance: typeof Appearance;
let css: typeof Css;

beforeEach(async () => {
  saved.clear();
  gates.clear();
  invoked.length = 0;
  vars.clear();
  vi.resetModules();
  engine = await import('./engine');
  looks = await import('./looks');
  appearance = await import('./appearance');
  css = await import('./custom-css');
});

const shown = () => vars.get('--color-accent');

describe('accent and theme', () => {
  it("picking a theme drops a picked accent, so the theme shows its own colour", async () => {
    await engine.chooseTheme('crimson');
    await engine.setAccent('#3e9bff');
    expect(saved.get('theme.accent')).toBe('#3e9bff');
    expect(shown()).toBe('#3e9bff');
    await engine.chooseTheme('afterglow');
    expect(saved.get('theme.accent')).toBeNull();
    expect(engine.currentAccentChoice()).toBe('theme');
    expect(shown()).toBe('#ff9157');
  });

  it("saves the theme's colour as no override, and picking the theme's own hex is the same", async () => {
    await engine.chooseTheme('nord');
    await engine.setAccent('#88c0d0');
    expect(engine.currentAccentChoice()).toBe('theme');
    await engine.setAccent('#46c28e');
    await engine.setAccent('theme');
    expect(saved.get('theme.accent')).toBeNull();
    expect(shown()).toBe('#88c0d0');
  });

  it('keeps an older saved accent (a hex code) on load', async () => {
    saved.set('theme', 'crimson');
    saved.set('theme.accent', '#f5a524');
    await engine.loadTheme().catch(() => {});
    expect(engine.currentAccentChoice()).toBe('#f5a524');
    expect(shown()).toBe('#f5a524');
  });

  it('restoring a Look puts the saved accent back after its theme', async () => {
    saved.set(looks.LOOK_BACKUP_KEY, { theme: 'dark', accent: '#46c28e' });
    await looks.restoreLook();
    expect(engine.currentThemeId()).toBe('dark');
    expect(saved.get('theme.accent')).toBe('#46c28e');
    expect(shown()).toBe('#46c28e');
  });

  it("a Look shows its theme's colour, and restoring it brings back the picked accent", async () => {
    await engine.chooseTheme('nord');
    await engine.setAccent('#46c28e');
    await looks.applyLook('crimson');
    expect(engine.currentAccentChoice()).toBe('theme');
    expect(shown()).toBe('#e3101e');
    expect((saved.get(looks.LOOK_BACKUP_KEY) as { accent: string }).accent).toBe('#46c28e');
    await looks.restoreLook();
    expect(engine.currentThemeId()).toBe('nord');
    expect(engine.currentAccentChoice()).toBe('#46c28e');
    expect(shown()).toBe('#46c28e');
  });
});

describe('choosing themes quickly', () => {
  it("doesn't let an overtaken theme apply its fonts over the newer one's", async () => {
    await engine.chooseTheme('nord');
    await engine.setFonts('editorial');
    const first = await engine.saveCurrentAs('First');
    await engine.chooseTheme('dracula');
    await engine.setFonts('plex');
    const second = await engine.saveCurrentAs('Second');

    // The first theme's parts are slow to load; the second is chosen meanwhile.
    let release!: () => void;
    gates.set(`theme.css.${first.id}`, new Promise<void>((resolve) => (release = resolve)));
    const slow = engine.chooseTheme(first.id);
    await engine.chooseTheme(second.id);
    release();
    await slow;

    expect(engine.currentThemeId()).toBe(second.id);
    expect(engine.currentFonts()).toBe('plex');
  });
});

describe("a Look's scale", () => {
  const scale = () => appearance.appearance().scale;
  const backupScale = () => (saved.get(looks.LOOK_BACKUP_KEY) as { scale?: unknown } | null)?.scale;

  it("Couch sets 150% and restoring puts the person's scale back", async () => {
    await appearance.setAppearance({ scale: 110 });
    await looks.applyLook('couch');
    expect(scale()).toBe(150);
    expect(backupScale()).toEqual({ own: 110, look: 150 });
    expect(looks.activeLook(parsePlayerLayout(saved.get('player.layout')))?.id).toBe('couch');
    await looks.restoreLook();
    expect(scale()).toBe(110);
    expect(saved.get(looks.LOOK_BACKUP_KEY)).toBeNull();
  });

  it("going from Couch to a Look without a scale gives the person's back, and the snapshot forgets it", async () => {
    await appearance.setAppearance({ scale: 90 });
    await looks.applyLook('crimson');
    expect(backupScale()).toBeUndefined();
    await looks.applyLook('couch');
    expect(scale()).toBe(150);
    await looks.applyLook('premiere');
    expect(scale()).toBe(90);
    expect(backupScale()).toBeUndefined();
    // The rest of the snapshot is still the first Look's.
    expect((saved.get(looks.LOOK_BACKUP_KEY) as { theme: string }).theme).toBe('dark');
  });

  it('a scale changed by hand while Couch is on stays, through another Look and a restore', async () => {
    await appearance.setAppearance({ scale: 100 });
    await looks.applyLook('couch');
    await appearance.setAppearance({ scale: 125 });
    await looks.applyLook('orbit');
    expect(scale()).toBe(125);
    await looks.applyLook('couch');
    await appearance.setAppearance({ scale: 110 });
    await looks.restoreLook();
    expect(scale()).toBe(110);
  });
});

describe("a Look's fonts", () => {
  const backupFonts = () => (saved.get(looks.LOOK_BACKUP_KEY) as { fonts?: unknown } | null)?.fonts;

  it("Marquee sets its billboard type, a Look without fonts gives the person's back, and restoring keeps theirs", async () => {
    await engine.setFonts('plex');
    await looks.applyLook('marquee');
    expect(engine.currentFonts()).toBe('orbit');
    expect(backupFonts()).toEqual({ own: 'plex', look: 'orbit' });
    expect(looks.activeLook(parsePlayerLayout(saved.get('player.layout')))?.id).toBe('marquee');
    await looks.applyLook('crimson');
    expect(engine.currentFonts()).toBe('plex');
    expect(backupFonts()).toBeUndefined();
    await looks.applyLook('afterglow');
    await looks.restoreLook();
    expect(engine.currentFonts()).toBe('plex');
  });

  it('fonts changed by hand while a Look is on stay', async () => {
    await looks.applyLook('premiere');
    await engine.setFonts('grotesk');
    await looks.restoreLook();
    expect(engine.currentFonts()).toBe('grotesk');
  });
});

describe('a Theme Studio preview', () => {
  it("shows its layout without changing the one the rest of Orbit reads, and showing the current look puts it back", async () => {
    const { currentNavLayout } = await import('./layout');
    const before = currentNavLayout();
    engine.previewLook({ ...engine.currentLook(), layout: { ...before, position: 'rail' } });
    expect(html.dataset.nav).toBe('rail');
    expect(currentNavLayout()).toBe(before);
    engine.previewLook(engine.currentLook());
    expect(html.dataset.nav).toBe(before.position);
  });
});

describe("a Look and the player's control size", () => {
  it("keeps the person's own control scale", async () => {
    saved.set('player.layout', { ...parsePlayerLayout(null), scale: 1.2 });
    await looks.applyLook('crimson');
    const player = parsePlayerLayout(saved.get('player.layout'));
    expect(player.preset).toBe('theater');
    expect(player.scale).toBe(1.2);
    expect(looks.activeLook(player)?.id).toBe('crimson');
  });
});

describe('restoring a Look whose saved theme was deleted since', () => {
  it("falls back on Orbit's own theme and still puts the rest back", async () => {
    const mine = await engine.importTheme(JSON.stringify({ orbitTheme: 1, name: 'Mine', colors: { bg: '#101010', panel: '#181818', raised: '#202020', text: '#ffffff', muted: '#aaaaaa', faint: '#666666', accent: '#ff0000', danger: '#ff4444' }, fonts: 'plex' }));
    await appearance.setAppearance({ heroStyle: 'split' });
    await looks.applyLook('crimson');
    await engine.deleteTheme(mine.id);
    expect(await looks.restoreLook()).toBe(true);
    expect(engine.currentThemeId()).toBe('dark');
    expect(appearance.appearance().heroStyle).toBe('split');
    expect(engine.currentFonts()).toBe('plex');
    expect(saved.get(looks.LOOK_BACKUP_KEY)).toBeNull();
  });
});

describe('deleting a theme', () => {
  const file =(extra: Record<string, unknown>) =>
    JSON.stringify({ orbitTheme: 1, name: 'Mine', colors: { bg: '#101010', panel: '#181818', raised: '#202020', text: '#ffffff', muted: '#aaaaaa', faint: '#666666', accent: '#ff0000', danger: '#ff4444' }, fonts: 'plex', ...extra });

  it("takes the active theme's CSS and fonts away with it", async () => {
    const mine = await engine.importTheme(file({ css: '.x { color: red; }' }));
    expect(css.currentCss()).toBe('.x { color: red; }');
    expect(engine.currentFonts()).toBe('plex');
    await engine.deleteTheme(mine.id);
    expect(engine.currentThemeId()).toBe('dark');
    expect(saved.get('theme.css')).toBe('');
    expect(css.currentCss()).toBe('');
    expect(engine.currentFonts()).toBe('inter');
  });

  it("leaves CSS the theme didn't bring", async () => {
    await engine.saveLook({ ...engine.currentLook(), css: '.keep {}' });
    const plain = await engine.importTheme(file({}));
    expect(css.currentCss()).toBe('.keep {}');
    await engine.deleteTheme(plain.id);
    expect(css.currentCss()).toBe('.keep {}');
  });

  it("changes nothing when the theme isn't the active one", async () => {
    const other = await engine.importTheme(file({ name: 'Other', css: '.other {}' }));
    const active = await engine.importTheme(file({ name: 'Active', css: '.active {}', fonts: 'editorial' }));
    await engine.deleteTheme(other.id);
    expect(engine.currentThemeId()).toBe(active.id);
    expect(css.currentCss()).toBe('.active {}');
    expect(engine.currentFonts()).toBe('editorial');
    expect(engine.myThemes().map((t) => t.id)).toEqual([active.id]);
  });
});

describe('seek-bar pictures', () => {
  const kept = () => (invoked.filter(([cmd]) => cmd === 'theme_image_prune').at(-1)?.[1] as { keep: string[] } | undefined)?.keep;

  it("keeps the pictures Theme Studio's open edit shows when the saved bar changes meanwhile, until it closes", async () => {
    const look = engine.currentLook();
    // Uploaded in the Studio and shown, not saved yet; then the player colour is changed in Settings.
    engine.previewLook({ ...look, seekbar: { ...look.seekbar, barImage: 'upload-draft' } });
    await engine.setSeekBarColor('#ff0000');
    expect(kept()).toContain('upload-draft');
    // The Studio closed (the edit thrown away): nothing holds it any more.
    engine.releaseSeekImages();
    await engine.setSeekBarColor(null);
    expect(kept()).not.toContain('upload-draft');
  });
});

describe("a theme's Type & finish", () => {
  it('comes back with the theme Theme Studio saved it in', async () => {
    const own = await engine.saveLook({ ...engine.currentLook(), name: 'Mine', appearance: { ...engine.currentLook().appearance, glow: 'strong', corners: 'sharp', posterSize: 'small' } });
    await engine.chooseTheme('nord');
    await appearance.setAppearance({ glow: 'off', corners: 'round', posterSize: 'large' });
    await engine.chooseTheme(own.id);
    expect(appearance.appearance()).toMatchObject({ glow: 'strong', corners: 'sharp', posterSize: 'small' });
  });

  it('is saved, with the menu, seek bar and CSS, by Save current as', async () => {
    await engine.saveLook({ ...engine.currentLook(), name: 'Studio', css: '.mine {}', appearance: { ...engine.currentLook().appearance, heroStyle: 'split' } });
    const copy = await engine.saveCurrentAs('Copy');
    expect(copy.appearance?.heroStyle).toBe('split');
    expect(copy.layout).toBeDefined();
    expect(copy.seekbar).toBeDefined();
    expect(saved.get(`theme.css.${copy.id}`)).toBe('.mine {}');
  });

  it('is saved with no CSS by Save current as, so another theme\'s CSS goes when it is chosen', async () => {
    const styled = await engine.saveLook({ ...engine.currentLook(), name: 'Styled', css: '.styled {}' });
    await engine.chooseTheme('nord');
    await engine.saveLook({ ...engine.currentLook(), css: '' }, 'nord');
    const plain = await engine.saveCurrentAs('Plain');
    await engine.chooseTheme(styled.id);
    expect(css.currentCss()).toBe('.styled {}');
    await engine.chooseTheme(plain.id);
    expect(css.currentCss()).toBe('');
  });
});
