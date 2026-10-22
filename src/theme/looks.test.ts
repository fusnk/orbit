import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, choosePreset, DEFAULT_LAYOUT, PRESETS as PLAYER_PRESETS, SIZES } from '../rooms/player/layout';
import { APPEARANCE_DEFAULTS, CORNERS, DETAIL_BACKGROUNDS, DETAIL_LAYOUTS, GLOW, HERO_STYLES, POSTER_SIZES, ROW_STYLE_DEFAULTS, SCALES } from './appearance';
import { NAV_ALIGNS, NAV_PLACES, NAV_POSITIONS, NAV_SIDES } from './layout';
import { FONT_PAIRS } from './fonts';
import { findLook, fontsFor, isTvSetup, LOOK_IDS, lookDefault, LOOKS, matchesLook, ownScale, parseLookBackup, playerFor, scaleFor, type LookState } from './looks';
import { findPreset } from './palette';

describe('looks', () => {
  it('each refers only to themes and layout values Orbit has', () => {
    expect(LOOKS.map((look) => look.id)).toEqual([...LOOK_IDS]);
    for (const look of LOOKS) {
      expect(findPreset(look.theme), `${look.id}'s theme`).toBeDefined();
      expect(Object.keys(GLOW)).toContain(look.appearance.glow);
      expect(HERO_STYLES).toContain(look.appearance.heroStyle);
      expect(DETAIL_LAYOUTS).toContain(look.appearance.detailLayout);
      expect(DETAIL_BACKGROUNDS).toContain(look.appearance.detailBackground);
      expect(Object.keys(CORNERS)).toContain(look.appearance.corners);
      expect(Object.keys(POSTER_SIZES)).toContain(look.appearance.posterSize);
      expect(NAV_POSITIONS).toContain(look.nav.position);
      expect(NAV_SIDES).toContain(look.nav.side);
      expect(NAV_ALIGNS).toContain(look.nav.align);
      if (look.nav.place) expect(NAV_PLACES).toContain(look.nav.place);
      expect(PLAYER_PRESETS).toContain(look.player.preset);
      if (look.player.size) expect(SIZES).toContain(look.player.size);
      if (look.player.background) expect(BACKGROUNDS).toContain(look.player.background);
      if (look.scale) expect(SCALES).toContain(look.scale);
      if (look.fonts) expect(FONT_PAIRS.map((pair) => pair.id)).toContain(look.fonts);
    }
  });

  it('leave the glow at the stock level or below', () => {
    for (const look of LOOKS) expect(GLOW[look.appearance.glow], look.id).toBeLessThanOrEqual(GLOW.normal);
  });

  it('match the settings they set and nothing looser', () => {
    const orbit = LOOKS[0]!;
    const stock: LookState = { theme: 'dark', accent: 'theme', appearance: orbit.appearance, scale: 100, fonts: 'inter', nav: { position: 'top', side: 'start', align: 'center' }, player: DEFAULT_LAYOUT };
    expect(matchesLook(orbit, stock)).toBe(true);
    // The side only matters beside the page; the clock isn't part of a Look.
    expect(matchesLook(orbit, { ...stock, nav: { ...stock.nav, side: 'end' }, player: { ...DEFAULT_LAYOUT, clock: true } })).toBe(true);
    expect(matchesLook(orbit, { ...stock, nav: { ...stock.nav, align: 'start' } })).toBe(false);
    expect(matchesLook(orbit, { ...stock, theme: 'nord' })).toBe(false);
    // A Look shows its theme's own accent: another one picked since makes the setup custom.
    expect(matchesLook(orbit, { ...stock, accent: '#46c28e' })).toBe(false);
    expect(matchesLook(orbit, { ...stock, appearance: { ...orbit.appearance, heroStyle: 'spotlight' } })).toBe(false);
    expect(matchesLook(orbit, { ...stock, player: { ...DEFAULT_LAYOUT, size: 'large' } })).toBe(false);
    // The floating pill's place counts only for a Look that uses the pill.
    expect(matchesLook(orbit, { ...stock, nav: { ...stock.nav, place: 'top-end' } })).toBe(true);
    const aurora = LOOKS.find((look) => look.id === 'aurora')!;
    const auroraState: LookState = { ...stock, theme: aurora.theme, appearance: aurora.appearance, fonts: 'grotesk', nav: { ...aurora.nav }, player: choosePreset(DEFAULT_LAYOUT, 'floating') };
    expect(matchesLook(aurora, auroraState)).toBe(true);
    expect(matchesLook(aurora, { ...auroraState, nav: { ...aurora.nav, place: 'top' } })).toBe(false);
    // The scale counts only for a Look that sets it.
    expect(matchesLook(orbit, { ...stock, scale: 150 })).toBe(true);
    const couch = findLook('couch')!;
    const couchState: LookState = { ...stock, theme: couch.theme, appearance: couch.appearance, scale: 150, fonts: 'montserrat', nav: { ...couch.nav }, player: { ...choosePreset(DEFAULT_LAYOUT, 'tv'), size: 'large' } };
    expect(matchesLook(couch, couchState)).toBe(true);
    expect(matchesLook(couch, { ...couchState, scale: 125 })).toBe(false);
    // A custom control scale stands in for the size, so Couch's large isn't on screen under one.
    expect(matchesLook(couch, { ...couchState, player: { ...couchState.player, scale: 0.8 } })).toBe(false);
    expect(matchesLook(orbit, { ...stock, player: { ...DEFAULT_LAYOUT, scale: 1.1 } })).toBe(true);
    // The fonts count only for a Look that sets them.
    expect(matchesLook(couch, { ...couchState, fonts: 'inter' })).toBe(false);
    expect(matchesLook(orbit, { ...stock, fonts: 'editorial' })).toBe(true);
    // Every Look is told apart from the stock one.
    for (const look of LOOKS.slice(1)) expect(matchesLook(look, stock), look.id).toBe(false);
  });

  it('read a snapshot and drop an unreadable one', () => {
    for (const junk of [null, 0, '', [], {}, { theme: 'nope', accent: '#ffffff' }, { theme: 'dark', accent: 'red' }]) expect(parseLookBackup(junk)).toBeNull();
    const backup = parseLookBackup({ theme: 'nord', accent: '#88c0d0', appearance: { heroStyle: 'spotlight', glow: 'blinding' }, nav: { position: 'rail' }, player: { preset: 'tv' } });
    expect(backup?.theme).toBe('nord');
    expect(backup?.appearance.heroStyle).toBe('spotlight');
    expect(backup?.appearance.glow).toBe('normal');
    expect(backup?.nav.position).toBe('rail');
    expect(backup?.player.preset).toBe('tv');
    expect(backup?.accent).toBe('#88c0d0');
  });

  it('keep Orbit Arc to Orbit’s own pages, changing only the menu and the player', () => {
    const orbit = findLook('orbit')!;
    const arc = findLook('arc')!;
    expect(arc.theme).toBe(orbit.theme);
    expect(arc.appearance).toEqual(orbit.appearance);
    expect(arc.fonts).toBe(orbit.fonts);
    const state: LookState = { theme: 'dark', accent: 'theme', appearance: arc.appearance, scale: 100, fonts: 'inter', nav: { position: 'arc', side: 'start', align: 'center' }, player: choosePreset(DEFAULT_LAYOUT, 'arc') };
    // The Arc bar is always after the wordmark: a saved alignment doesn't matter.
    expect(matchesLook(arc, state)).toBe(true);
    expect(matchesLook(orbit, state)).toBe(false);
    expect(matchesLook(arc, { ...state, player: DEFAULT_LAYOUT })).toBe(false);
    expect(isTvSetup(arc.nav, arc.player)).toBe(false);
  });

  it('set the card shape: landscape for Crimson and Aurora, posters for the rest', () => {
    expect(LOOKS.filter((look) => look.appearance.rowStyle === 'landscape').map((look) => look.id)).toEqual(['crimson', 'aurora']);
    for (const look of LOOKS) expect(ROW_STYLE_DEFAULTS).toContain(look.appearance.rowStyle);
    const crimson = findLook('crimson')!;
    const state: LookState = { theme: crimson.theme, accent: 'theme', appearance: crimson.appearance, scale: 100, fonts: 'inter', nav: { ...crimson.nav }, player: choosePreset(DEFAULT_LAYOUT, 'theater') };
    expect(matchesLook(crimson, state)).toBe(true);
    expect(matchesLook(crimson, { ...state, appearance: { ...crimson.appearance, rowStyle: 'poster' } })).toBe(false);
    // Snapshots from before the setting existed read as posters.
    expect(parseLookBackup({ theme: 'dark', accent: 'theme', appearance: { glow: 'off' } })?.appearance.rowStyle).toBe('poster');
    expect(parseLookBackup({ theme: 'dark', accent: 'theme', appearance: { rowStyle: 'landscape' } })?.appearance.rowStyle).toBe('landscape');
  });

  it('let rows overlap the banner in Crimson only, and read older snapshots as off', () => {
    expect(LOOKS.filter((look) => look.appearance.heroOverlap).map((look) => look.id)).toEqual(['crimson']);
    const crimson = findLook('crimson')!;
    const state: LookState = { theme: crimson.theme, accent: 'theme', appearance: crimson.appearance, scale: 100, fonts: 'inter', nav: { ...crimson.nav }, player: choosePreset(DEFAULT_LAYOUT, 'theater') };
    expect(matchesLook(crimson, { ...state, appearance: { ...crimson.appearance, heroOverlap: false } })).toBe(false);
    expect(parseLookBackup({ theme: 'dark', accent: 'theme', appearance: { glow: 'off' } })?.appearance.heroOverlap).toBe(false);
  });

  it("read a snapshot's scale only when both halves are scales", () => {
    const base = { theme: 'dark', accent: 'theme' };
    expect(parseLookBackup({ ...base, scale: { own: 110, look: 150 } })?.scale).toEqual({ own: 110, look: 150 });
    for (const junk of [undefined, null, 150, { own: 110 }, { own: 115, look: 150 }, { own: '110', look: 150 }]) expect(parseLookBackup({ ...base, scale: junk })?.scale).toBeUndefined();
  });

  it("read a snapshot's accent as the theme's colour when it has none or the sentinel", () => {
    expect(parseLookBackup({ theme: 'crimson', accent: 'theme' })?.accent).toBe('theme');
    expect(parseLookBackup({ theme: 'crimson' })?.accent).toBe('theme');
  });
});

describe('a Look that sets the scale', () => {
  const couch = findLook('couch')!;
  const orbit = findLook('orbit')!;

  it('is Couch alone, at 150%', () => {
    expect(LOOKS.filter((look) => look.scale).map((look) => [look.id, look.scale])).toEqual([['couch', 150]]);
  });

  it("keeps the person's own scale while its own is on screen", () => {
    expect(scaleFor(couch, 110, undefined)).toEqual({ scale: 150, saved: { own: 110, look: 150 } });
    // Couch again (or after another scale-setting Look): the saved scale is still theirs, not Couch's.
    expect(scaleFor(couch, 150, { own: 110, look: 150 })).toEqual({ scale: 150, saved: { own: 110, look: 150 } });
  });

  it("gives the person's scale back for a Look without one", () => {
    expect(scaleFor(orbit, 150, { own: 110, look: 150 })).toEqual({ scale: 110, saved: undefined });
    // Never had a Look's scale: nothing changes.
    expect(scaleFor(orbit, 125, undefined)).toEqual({ scale: 125, saved: undefined });
  });

  it('leaves a scale changed by hand since', () => {
    expect(ownScale(125, { own: 110, look: 150 })).toBe(125);
    expect(scaleFor(orbit, 125, { own: 110, look: 150 })).toEqual({ scale: 125, saved: undefined });
    expect(scaleFor(couch, 125, { own: 110, look: 150 })).toEqual({ scale: 150, saved: { own: 125, look: 150 } });
  });

  it("restores the person's scale only while the Look's is on screen", () => {
    expect(ownScale(150, { own: 90, look: 150 })).toBe(90);
    expect(ownScale(100, { own: 90, look: 150 })).toBe(100);
    expect(ownScale(150, undefined)).toBe(150);
  });
});

describe('Looks that differ', () => {
  it('each bring a different frame, not only colours', () => {
    const frame = (look: (typeof LOOKS)[number]) =>
      JSON.stringify([look.nav.position, look.nav.align, look.nav.place, look.appearance.heroStyle, look.appearance.rowStyle, look.appearance.corners, look.appearance.posterSize, look.player.preset, look.fonts]);
    expect(new Set(LOOKS.map(frame)).size).toBe(LOOKS.length);
    expect(new Set(LOOKS.filter((look) => look.id !== 'arc').map((look) => look.theme)).size).toBe(LOOKS.length - 1);
  });

  it("leave the person's own fonts in Orbit, Crimson and Orbit Arc", () => {
    expect(LOOKS.filter((look) => !look.fonts).map((look) => look.id)).toEqual(['orbit', 'crimson', 'arc']);
  });
});

describe("a Look's fonts", () => {
  const marquee = findLook('marquee')!;
  const crimson = findLook('crimson')!;

  it("set the Look's and keep the person's own beside them", () => {
    expect(fontsFor(marquee, 'plex', undefined)).toEqual({ fonts: 'orbit', saved: { own: 'plex', look: 'orbit' } });
    expect(fontsFor(findLook('afterglow')!, 'orbit', { own: 'plex', look: 'orbit' })).toEqual({ fonts: 'editorial', saved: { own: 'plex', look: 'editorial' } });
  });

  it("give the person's own back for a Look without them, unless changed by hand since", () => {
    expect(fontsFor(crimson, 'orbit', { own: 'plex', look: 'orbit' })).toEqual({ fonts: 'plex', saved: undefined });
    expect(fontsFor(crimson, 'jakarta', { own: 'plex', look: 'orbit' })).toEqual({ fonts: 'jakarta', saved: undefined });
  });

  it('read from a snapshot only when both halves are font pairs', () => {
    const base = { theme: 'dark', accent: 'theme' };
    expect(parseLookBackup({ ...base, fonts: { own: 'plex', look: 'orbit' } })?.fonts).toEqual({ own: 'plex', look: 'orbit' });
    for (const junk of [undefined, 'orbit', { own: 'plex' }, { own: 'comic-sans', look: 'orbit' }]) expect(parseLookBackup({ ...base, fonts: junk })?.fonts).toBeUndefined();
  });
});

describe('TV mode', () => {
  it("is on with Couch's sidebar and TV player, whatever else changed", () => {
    expect(isTvSetup({ position: 'sidebar' }, { preset: 'tv' })).toBe(true);
    expect(isTvSetup({ position: 'top' }, { preset: 'tv' })).toBe(false);
    expect(isTvSetup({ position: 'sidebar' }, { preset: 'orbit' })).toBe(false);
  });
});

describe('a Look’s player', () => {
  it('keeps the person’s control scale, unless the Look sets a size of its own', () => {
    const custom = { ...DEFAULT_LAYOUT, scale: 0.8 };
    expect(playerFor(findLook('orbit')!, custom).scale).toBe(0.8);
    const couch = playerFor(findLook('couch')!, custom);
    expect(couch.size).toBe('large');
    expect(couch.scale).toBeUndefined();
  });
});

describe('"Reset this section" with a Look on', () => {
  it('goes back to the Look’s own values, not Orbit’s, for what the Look sets', () => {
    const premiere = findLook('premiere')!;
    expect(lookDefault(premiere, 'tint')).toBe(true);
    expect(lookDefault(premiere, 'heroStyle')).toBe('carousel');
    expect(lookDefault(premiere, 'corners')).toBe('round');
    // Premiere leaves the glow as stock, and so does the reset.
    expect(lookDefault(premiere, 'glow')).toBe(APPEARANCE_DEFAULTS.glow);
  });

  it('keeps a Look’s scale, and the person’s own where the Look sets none', () => {
    expect(lookDefault(findLook('couch')!, 'scale')).toBe(150);
    expect(lookDefault(findLook('premiere')!, 'scale')).toBe(APPEARANCE_DEFAULTS.scale);
  });

  it('uses Orbit’s defaults for rows no Look sets, and for everything without a Look', () => {
    expect(lookDefault(findLook('premiere')!, 'logos')).toBe(APPEARANCE_DEFAULTS.logos);
    expect(lookDefault(undefined, 'tint')).toBe(APPEARANCE_DEFAULTS.tint);
    expect(lookDefault(undefined, 'scale')).toBe(APPEARANCE_DEFAULTS.scale);
  });
});
