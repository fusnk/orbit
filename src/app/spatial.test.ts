import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { besideRegion, centerDelta, chooseNext, closestTo, intoBanner, isEditing, middleWithin, nearestDelta, pickNext, repeatAllowed, type Direction } from './spatial';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

// Rectangles measured from the Home page at 1280×800.
const play = rect(96, 480, 92, 44);
const details = rect(198, 480, 110, 44);
const dots = rect(1116, 541, 84, 6);
const dismiss = rect(1182, 634, 32, 32);
const install = rect(846, 844, 146, 44);
const browse = rect(1002, 844, 190, 44);
const seeAll = rect(1070, 956, 70, 32);
const cw1 = rect(40, 1000, 320, 226);
const cw2 = rect(376, 1000, 320, 226);
const cw3 = rect(712, 1000, 320, 226);

const layout = {
  play,
  details,
  dots,
  dismiss,
  install,
  browse,
  seeAll,
  cw1,
  cw2,
  cw3,
};
type Name = keyof typeof layout;
const horizontalOnly = new Set<Name>(['dots', 'seeAll']);

function next(from: Name, direction: Direction): Name | null {
  const options = (Object.keys(layout) as Name[])
    .filter((name) => name !== from)
    .map((name) => ({ item: name, rect: layout[name], horizontalOnly: horizontalOnly.has(name) }));
  return pickNext(layout[from], options, direction);
}

describe('pickNext', () => {
  it('moves along a row with left/right', () => {
    expect(next('play', 'right')).toBe('details');
    expect(next('cw1', 'right')).toBe('cw2');
    expect(next('cw2', 'left')).toBe('cw1');
  });

  it('visits the next row down even when it sits off to one side', () => {
    // The welcome card is the next row below the hero, so it isn't skipped.
    expect(next('play', 'down')).toBe('dismiss');
    expect(next('dismiss', 'down')).toBe('browse');
    expect(next('install', 'down')).toBe('cw3');
  });

  it('picks the closest element across within the next row', () => {
    expect(next('cw1', 'up')).toBe('install');
    expect(next('browse', 'left')).toBe('install');
  });

  it('skips horizontal-only controls when moving up or down', () => {
    expect(next('details', 'down')).not.toBe('dots');
    expect(next('install', 'down')).not.toBe('seeAll');
  });

  it('still reaches horizontal-only controls with left/right', () => {
    expect(next('cw3', 'right')).toBe('seeAll');
    expect(next('details', 'right')).toBe('dots');
    expect(next('browse', 'right')).toBeNull();
  });
});

describe('isEditing', () => {
  // Node has no DOM: stand-ins just big enough for the instanceof checks.
  class FakeElement extends EventTarget {
    isContentEditable = false;
  }
  class FakeInput extends FakeElement {
    constructor(
      public type = 'text',
      public readOnly = false,
    ) {
      super();
    }
  }
  class FakeTextArea extends FakeElement {
    constructor(public readOnly = false) {
      super();
    }
  }

  beforeAll(() => {
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('HTMLTextAreaElement', FakeTextArea);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('is true for fields that take typing, including the PIN field', () => {
    expect(isEditing(new FakeInput())).toBe(true);
    expect(isEditing(new FakeInput('password'))).toBe(true);
    expect(isEditing(new FakeTextArea())).toBe(true);
    const editable = new FakeElement();
    editable.isContentEditable = true;
    expect(isEditing(editable)).toBe(true);
  });

  it('is false for read-only fields (focused, not yet activated) and non-text inputs', () => {
    expect(isEditing(new FakeInput('text', true))).toBe(false);
    expect(isEditing(new FakeTextArea(true))).toBe(false);
    // A slider takes no typing: Backspace, shortcuts and ambient mode must still work while one is focused.
    for (const type of ['button', 'checkbox', 'color', 'radio', 'range']) expect(isEditing(new FakeInput(type))).toBe(false);
    expect(isEditing(new FakeElement())).toBe(false);
    expect(isEditing(null)).toBe(false);
  });
});

describe('separate favourite card controls', () => {
  const card = rect(40, 100, 230, 200);
  const heart = rect(278, 108, 34, 34);
  it('reaches the end-corner control with Right and returns with Left', () => {
    expect(pickNext(card, [{ item: 'heart', rect: heart }], 'right')).toBe('heart');
    expect(pickNext(heart, [{ item: 'card', rect: card }], 'left')).toBe('card');
  });
  it('mirrors the separate heart column in RTL', () => {
    expect(pickNext(rect(90, 100, 230, 200), [{ item: 'heart', rect: rect(48, 108, 34, 34) }], 'left')).toBe('heart');
  });
  it('does not move horizontally to a control on the wrong side', () => {
    expect(pickNext(card, [{ item: 'heart', rect: heart }], 'left')).toBeNull();
  });
});

describe('hero trailer navigation', () => {
  const action = rect(96, 480, 92, 44);
  const sound = rect(1180, 545, 40, 40);
  const mood = rect(96, 640, 100, 40);
  it('Down reaches the next row, Up returns to the action, and Right reaches sound', () => {
    expect(pickNext(action, [{ item: 'sound', rect: sound, horizontalOnly: true }, { item: 'mood', rect: mood }], 'down')).toBe('mood');
    expect(pickNext(mood, [{ item: 'sound', rect: sound, horizontalOnly: true }, { item: 'action', rect: action }], 'up')).toBe('action');
    expect(pickNext(action, [{ item: 'sound', rect: sound, horizontalOnly: true }], 'right')).toBe('sound');
  });
});

describe('middleWithin', () => {
  const screen = rect(0, 0, 1280, 800);
  const page = rect(0, 48, 1280, 752);
  it('counts a control whose middle shows in every box', () => {
    expect(middleWithin(rect(100, 700, 200, 80), screen, page)).toBe(true);
  });
  it('rejects a control scrolled above or below the page', () => {
    expect(middleWithin(rect(100, -400, 200, 80), screen, page)).toBe(false);
    expect(middleWithin(rect(100, 1600, 200, 80), screen, page)).toBe(false);
  });
  it('rejects a control under the title bar, outside the page', () => {
    expect(middleWithin(rect(100, 0, 200, 40), screen, page)).toBe(false);
  });
});

describe("Settings' sidebar (a region) and the pane", () => {
  // Measured at 1280x1080: 12 categories in a 256px column, pane rows 96px apart to its right, switches right-aligned.
  const sidebarBox = rect(36, 120, 256, 940);
  const sidebarRegion = { getBoundingClientRect: () => sidebarBox };
  const sidebar = Array.from({ length: 12 }, (_, i) => ({ item: `nav${i}`, rect: rect(40, 220 + i * 36, 248, 32), region: sidebarRegion }));
  const row1 = { item: 'row1', rect: rect(1150, 300, 44, 24) };
  const row2 = { item: 'row2', rect: rect(1150, 396, 44, 24) };
  // Low in Playback: "Black and white when paused", External player's segments in the row below, then the foot.
  const grayPause = { item: 'gray-pause', rect: rect(1150, 920, 44, 24) };
  const external = { item: 'external', rect: rect(760, 968, 360, 36) };
  const reset = { item: 'reset', rect: rect(1046, 1030, 148, 40) };
  // The title bar's profile button, further right than anything in the pane.
  const profile = { item: 'profile', rect: rect(1200, 8, 36, 36), titlebar: true };
  type Option = { item: string; rect: DOMRect; region?: typeof sidebarRegion; titlebar?: boolean };
  const page: Option[] = [...sidebar, row1, row2, grayPause, external, reset, profile];
  const from = (o: Option, direction: Direction, extra: Option[] = []) =>
    chooseNext({ rect: o.rect, region: o.region ?? null, titlebar: !!o.titlebar }, [...page, ...extra].filter((p) => p !== o), direction);

  it('Down and Up in the pane stay in the pane while it has rows that way', () => {
    expect(from(row1, 'down')).toBe('row2');
    expect(from(row2, 'up')).toBe('row1');
    expect(from(grayPause, 'down')).toBe('external');
  });

  it('Left from the pane reaches the categories, also from a row below the last of them', () => {
    expect(from(row1, 'left')).toMatch(/^nav/);
    expect(from(grayPause, 'left')).toMatch(/^nav/);
    expect(from(external, 'left')).toMatch(/^nav/);
  });

  it('Left still goes along the row first', () => {
    expect(from(grayPause, 'left', [{ item: 'segment', rect: rect(900, 920, 120, 24) }])).toBe('segment');
  });

  it('Right from the foot of the pane stays put rather than jump to the title bar', () => {
    expect(from(reset, 'right')).toBeNull();
  });

  it('Right from the categories reaches the pane', () => {
    expect(from(sidebar[2]!, 'right')).toBe('row1');
    expect(from(sidebar[11]!, 'right')).not.toBe('profile');
  });

  it('in a narrow window the categories sit above the pane, so Up from its first row reaches them', () => {
    const stackedBox = rect(24, 80, 760, 120);
    const stackedRegion = { getBoundingClientRect: () => stackedBox };
    const stacked = [0, 1, 2].map((i) => ({ item: `nav${i}`, rect: rect(24 + i * 110, 160, 100, 34), region: stackedRegion }));
    const topBar = { item: 'nav-pill', rect: rect(300, 8, 90, 32), titlebar: true };
    const first = rect(700, 260, 44, 24);
    const label = { item: 'label', rect: rect(24, 256, 200, 30) };
    expect(besideRegion(stackedBox, first)).toBe(false);
    expect(chooseNext({ rect: first, region: null, titlebar: false }, [...stacked, topBar], 'up')).toMatch(/^nav\d/);
    // The categories aren't beside it there: Left goes along the pane's row.
    expect(chooseNext({ rect: first, region: null, titlebar: false }, [...stacked, topBar, label], 'left')).toBe('label');
  });
});

describe('the sidebar and rail nav layouts', () => {
  // The nav is in the title bar's markup but sits beside the page, outside the title bar's strip,
  // so it isn't flagged as the title bar there and Left from the first column reaches it.
  const nav = Array.from({ length: 6 }, (_, i) => ({ item: `nav${i}`, rect: rect(20, 60 + i * 46, 184, 40) }));
  const cards = Array.from({ length: 3 }, (_, row) => ({ item: `card${row}`, rect: rect(240, 120 + row * 220, 160, 200) }));
  const profile = { item: 'profile', rect: rect(1200, 8, 36, 36), titlebar: true };

  it('Left from the first column reaches the nav', () => {
    for (const card of cards) expect(chooseNext({ rect: card.rect, region: null, titlebar: false }, [...nav, ...cards.filter((c) => c !== card), profile], 'left')).toMatch(/^nav\d/);
  });

  it('the nav sits in the title bar strip only in the top layouts', () => {
    const bar = rect(0, 0, 1280, 52);
    expect(middleWithin(nav[3]!.rect, bar)).toBe(false);
    expect(middleWithin(profile.rect, bar)).toBe(true);
  });
});

describe('Up from a row whose row above is scrolled under a floating title bar', () => {
  const above = [0, 1, 2].map((i) => ({ item: `above${i}`, rect: rect(48 + i * 236, -86, 224, 126) }));
  const home = { item: 'home', rect: rect(90, 16, 120, 32), titlebar: true };
  const card = rect(48, 126, 224, 126);
  it('goes back to that row, not up to the menu', () => {
    expect(chooseNext({ rect: card, region: null, titlebar: false }, [...above, home], 'up')).toBe('above0');
  });
  it('reaches the menu once nothing in the page lies up', () => {
    expect(chooseNext({ rect: card, region: null, titlebar: false }, [home], 'up')).toBe('home');
  });
});

describe('nearestDelta and centerDelta (what a key press scrolls)', () => {
  const view = { start: 100, end: 600 };
  it('leaves something in view where it is', () => {
    expect(nearestDelta({ start: 200, end: 300 }, view)).toBe(0);
  });
  it('brings something cut off in by the least', () => {
    expect(nearestDelta({ start: 550, end: 650 }, view)).toBe(50);
    expect(nearestDelta({ start: 60, end: 160 }, view)).toBe(-40);
    // Taller than the view: its start.
    expect(nearestDelta({ start: 50, end: 900 }, view)).toBe(-50);
  });
  it('centres on the middle', () => {
    expect(centerDelta({ start: 600, end: 700 }, view)).toBe(300);
  });
});

describe('repeatAllowed (a held key)', () => {
  it("moves at most once an interval, by the events' own times", () => {
    expect(repeatAllowed(false, 1000, 990, 110)).toBe(true);
    expect(repeatAllowed(true, 1050, 1000, 110)).toBe(false);
    expect(repeatAllowed(true, 1110, 1000, 110)).toBe(true);
  });
});

describe('closestTo', () => {
  it('picks the option whose middle is nearest the point', () => {
    const options = [
      { item: 'far', rect: rect(900, 100, 100, 100) },
      { item: 'near', rect: rect(120, 120, 100, 100) },
    ];
    expect(closestTo({ x: 150, y: 150 }, options)).toBe('near');
    expect(closestTo({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('Up from the first row into Home’s banner', () => {
  // The Shield's Home scrolled one row down: the banner's buttons sit high, its trailer speaker low in the
  // end corner (the nearest thing up from the row), its dots only reachable sideways.
  const banner = {
    play: rect(48, 150, 110, 40),
    details: rect(168, 150, 100, 40),
    sound: rect(870, 300, 34, 34),
    dots: { ...rect(780, 312, 60, 8) },
  };
  const row = [0, 1, 2, 3].map((i) => ({ item: `card${i}`, rect: rect(48 + i * 236, 380, 224, 126) }));
  const menu = { item: 'menu', rect: rect(90, 16, 120, 32), titlebar: true };
  const options = [
    { item: 'play', rect: banner.play },
    { item: 'details', rect: banner.details },
    { item: 'sound', rect: banner.sound },
    { item: 'dots', rect: banner.dots, horizontalOnly: true },
    ...row,
    menu,
  ];
  const inBanner = new Set(['play', 'details', 'sound', 'dots']);
  const hero = { contains: (el: string) => inBanner.has(el), primary: 'play' };
  const up = (from: string) => {
    const origin = options.find((o) => o.item === from)!.rect;
    const picked = chooseNext({ rect: origin, region: null, titlebar: false }, options.filter((o) => o.item !== from), 'up');
    return picked && intoBanner(picked, from, inBanner.has(picked) ? hero : null, () => true);
  };

  it('lands on Play, whatever of the banner lies nearest', () => {
    for (const card of row) expect(up(card.item)).toBe('play');
  });
  it('and one more Up goes to the menu', () => {
    expect(up('play')).toBe('menu');
  });
  it('moves within the banner as usual once in it', () => {
    expect(intoBanner('details', 'sound', hero, () => true)).toBe('details');
  });
  it('keeps the nearest when its main button can’t be reached (disabled while loading)', () => {
    expect(intoBanner('sound', 'card0', hero, (el) => el !== 'play')).toBe('sound');
  });
});

