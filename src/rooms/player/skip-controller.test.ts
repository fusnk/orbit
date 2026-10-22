import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { Intro } from './learned-skips';
import type { SkipModes } from './skip';

/** Just enough of an element for the Skip button and the fade layer. */
class FakeEl extends EventTarget {
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  classes = new Set<string>();
  classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
  };
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    if (name === 'hidden') this.hidden = true;
    else this.attrs[name] = value;
  }
  removeAttribute(name: string): void {
    delete this.attrs[name];
  }
  toggleAttribute(name: string, on: boolean): void {
    if (on) this.attrs[name] = '';
    else delete this.attrs[name];
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) if (typeof node !== 'string') this.children.push(node);
  }
  click(): void {
    this.dispatchEvent(new Event('click'));
  }
}

const saved = new Map<string, unknown>();
const motion = { reduced: false };
const learned = new Map<string, Intro>();
const learnt: [string, Intro][] = [];
/** What `skip_segments` answers next, by IMDb id (a promise left pending until the test settles it). */
const lookups = new Map<string, Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: { imdbId?: string }) => {
    if (cmd === 'skip_segments') return lookups.get(args?.imdbId ?? '') ?? Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: () => 'en' }));
vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string | boolean> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== false) el.setAttribute(name, value === true ? '' : value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../lib/ipc', () => ({ settings: { get: async (key: string) => saved.get(key), set: async () => {} } }));
vi.mock('../../lib/platform', () => ({ isAndroid: false }));
vi.mock('../../theme/appearance', () => ({ reducedMotion: () => motion.reduced }));
vi.mock('./learned-skips', async (importOriginal) => {
  const real = await importOriginal<typeof import('./learned-skips')>();
  return {
    ...real,
    learnedSkips: {
      load: async () => {},
      get: (id: string) => learned.get(id),
      learn: (id: string, intro: Intro) => void learnt.push([id, intro]),
      forgetAll: async () => {},
    },
  };
});

const { invoke } = await import('@tauri-apps/api/core');
const { toast } = await import('../../components/toast');
const { createSkipController } = await import('./skip-controller');
const { AUTO_SKIP_DELAY_KEY, SKIP_LABELS, UNDO_MS } = await import('./skip');
const { SKIP_BUTTON_DELAY_KEY, SKIP_LANDING_KEY, SMOOTH_SKIP_KEY } = await import('./skip-tuning');
const { FADE_OUT_MS } = await import('./skip-transition');

const MODES = (overrides: Partial<SkipModes> = {}): SkipModes => ({ intro: 'button', recap: 'button', credits: 'button', preview: 'button', ...overrides });

/** A 25-minute episode: intro 60–150 and credits to the end (1400–1500), from its chapters. */
const CHAPTERS = [
  { title: 'Cold open', time: 0 },
  { title: 'Opening', time: 60 },
  { title: 'Part 1', time: 150 },
  { title: 'End Credits', time: 1400 },
];

const series = (id: string): Title => ({ id, type: 'series', name: 'Show', genres: [], origins: [] }) as unknown as Title;
const episode = (season: number, number: number) => ({ season, episode: { id: `${season}:${number}`, number, title: '' } });

let doc: EventTarget & { activeElement: unknown };

/** The player as the controller sees it: mpv's position, set by `at`, which then reports it (an mpv event). */
async function setup(options: { modes?: SkipModes; learn?: boolean; lookup?: boolean; handedOff?: boolean; next?: string | null; chapters?: boolean } = {}) {
  const pos = { timePos: null as number | null, duration: 1500 as number | null, started: true };
  const seeks: number[] = [];
  const host = {
    position: () => ({ ...pos }),
    creditsHandedOff: () => options.handedOff ?? false,
    seek: (seconds: number) => void seeks.push(seconds),
    next: () => options.next ?? null,
    playNext: vi.fn(),
    focusFallback: vi.fn(),
  };
  const skip = createSkipController(host);
  skip.configure({ lookup: options.lookup ?? false, modes: options.modes ?? MODES(), learn: options.learn ?? false });
  if (options.chapters ?? true) skip.setChapters(CHAPTERS);
  // The settings are read when the player opens.
  await vi.advanceTimersByTimeAsync(0);
  const button = skip.element as unknown as FakeEl;
  const at = (seconds: number | null) => {
    pos.timePos = seconds;
    skip.update();
  };
  return { skip, host, pos, seeks, button, at };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.stubGlobal('window', globalThis);
  doc = Object.assign(new EventTarget(), { activeElement: null as unknown });
  vi.stubGlobal('document', doc);
  saved.clear();
  // Most tests skip without the fade: the seek is then made at once.
  saved.set(SMOOTH_SKIP_KEY, false);
  motion.reduced = false;
  learned.clear();
  learnt.length = 0;
  lookups.clear();
  vi.mocked(invoke).mockClear();
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Skip button follows where mpv says playback is', () => {
  it('shows nothing until the file has started, even inside the intro', async () => {
    const { pos, button, at } = await setup();
    pos.started = false;
    at(70);
    expect(button.hidden).toBe(true);
    pos.started = true;
    at(70);
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe(SKIP_LABELS.intro);
  });

  it('comes up inside the intro and goes once mpv reports a position past it', async () => {
    const { button, at } = await setup();
    at(30);
    expect(button.hidden).toBe(true);
    at(61);
    expect(button.hidden).toBe(false);
    at(200);
    expect(button.hidden).toBe(true);
  });

  it('shows nothing while the position is unknown', async () => {
    const { button, at } = await setup();
    at(null);
    expect(button.hidden).toBe(true);
  });

  it('does nothing for a kind turned off', async () => {
    const { button, seeks, at } = await setup({ modes: MODES({ intro: 'off' }) });
    at(70);
    expect(button.hidden).toBe(true);
    expect(seeks).toEqual([]);
  });

  it('hands focus back when it disappears while focused', async () => {
    const { button, host, at } = await setup();
    at(70);
    doc.activeElement = button;
    at(200);
    expect(host.focusFallback).toHaveBeenCalledOnce();
  });
});

describe('pressing Skip', () => {
  it('seeks to the intro’s end, then offers the way back to where it was pressed', async () => {
    const { button, seeks, at } = await setup();
    at(70);
    button.click();
    expect(seeks).toEqual([150]);
    // Where mpv says it landed, the way back stands in for the button.
    at(150);
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('pstream.skip.back {"time":"1:10"}');
    button.click();
    expect(seeks).toEqual([150, 70]);
  });

  it('plays the intro after going back, rather than offering Back again', async () => {
    const { button, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(70);
    expect(seeks).toEqual([150]);
    at(150);
    button.click();
    expect(seeks).toEqual([150, 70]);
    at(71);
    at(80);
    // Taken back: not skipped automatically again, the plain button is there instead.
    expect(seeks).toEqual([150, 70]);
    expect(button.textContent).toBe(SKIP_LABELS.intro);
  });

  it('stops offering the way back after its time is up', async () => {
    const { button, at } = await setup();
    at(70);
    button.click();
    at(150.2);
    expect(button.textContent).toContain('pstream.skip.back');
    vi.advanceTimersByTime(UNDO_MS);
    expect(button.hidden).toBe(true);
  });

  it('lands the chosen seconds before the end, and isn’t offered again there', async () => {
    saved.set(SKIP_LANDING_KEY, 3);
    const { button, seeks, at } = await setup();
    at(70);
    button.click();
    expect(seeks).toEqual([147]);
    vi.advanceTimersByTime(UNDO_MS);
    at(147.5);
    expect(button.hidden).toBe(true);
  });

  it('on credits running to the end offers what plays next, and plays it', async () => {
    const { button, host, seeks, at } = await setup({ next: 'Next episode' });
    at(1410);
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Next episode');
    button.click();
    expect(host.playNext).toHaveBeenCalledOnce();
    expect(seeks).toEqual([]);
  });

  it('leaves the credits to Next Up when it handles them', async () => {
    const { button, at } = await setup({ next: 'Next episode', handedOff: true });
    at(1410);
    expect(button.hidden).toBe(true);
  });

  it('waits the chosen seconds of playback into the segment before showing', async () => {
    saved.set(SKIP_BUTTON_DELAY_KEY, 2);
    const { button, at } = await setup();
    at(61);
    expect(button.hidden).toBe(true);
    at(62.5);
    expect(button.hidden).toBe(true);
    at(63);
    expect(button.hidden).toBe(false);
  });
});

describe('skipping automatically', () => {
  it('skips once, saying what it skipped, and not again when mpv reports the same place', async () => {
    const { seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(61);
    expect(seeks).toEqual([150]);
    expect(toast).toHaveBeenCalledWith('player.skip.skipped-intro');
    at(61);
    at(62);
    expect(seeks).toEqual([150]);
  });

  it('doesn’t skip again after the viewer seeks back into the segment', async () => {
    const { button, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(61);
    at(150);
    vi.advanceTimersByTime(UNDO_MS);
    at(65);
    expect(seeks).toEqual([150]);
    expect(button.textContent).toBe(SKIP_LABELS.intro);
  });

  it('counts down in playback time, then skips', async () => {
    saved.set(AUTO_SKIP_DELAY_KEY, 3);
    const { button, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(61);
    expect(button.textContent).toBe(`playerplus.skip.auto-in ${JSON.stringify({ label: SKIP_LABELS.intro, seconds: 3 })}`);
    // Paused: mpv reports no new position, and the count waits however long it's been.
    vi.advanceTimersByTime(10_000);
    at(61);
    expect(seeks).toEqual([]);
    at(62.5);
    expect(button.textContent).toContain('"seconds":2');
    at(64);
    expect(seeks).toEqual([150]);
  });

  it('stops counting down at any key, and the intro plays on with its button', async () => {
    saved.set(AUTO_SKIP_DELAY_KEY, 3);
    const { button, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(61);
    doc.dispatchEvent(new Event('keydown'));
    expect(button.textContent).toBe(SKIP_LABELS.intro);
    at(70);
    expect(seeks).toEqual([]);
    expect(button.hidden).toBe(false);
  });

  it('stops counting down when another file loads, and stops listening for keys', async () => {
    saved.set(AUTO_SKIP_DELAY_KEY, 3);
    const { skip, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    const removed = vi.spyOn(doc, 'removeEventListener');
    at(61);
    skip.newFile();
    expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('plays a segment picked in the Chapters view instead of skipping it', async () => {
    const { skip, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    skip.watch({ kind: 'intro', start: 60, end: 150 });
    expect(seeks).toEqual([60]);
    at(60);
    at(70);
    expect(seeks).toEqual([60]);
  });

  it('skips credits running to the end to the very end, with no way back', async () => {
    saved.set(SKIP_LANDING_KEY, 3);
    const { button, seeks, at } = await setup({ modes: MODES({ credits: 'auto' }) });
    at(1405);
    expect(seeks).toEqual([1500]);
    at(1405);
    expect(button.textContent).not.toContain('pstream.skip.back');
  });
});

describe('the smooth skip', () => {
  it('fades out before seeking, and names the skip on the black rather than in a toast', async () => {
    saved.set(SMOOTH_SKIP_KEY, true);
    const { button, seeks, at } = await setup();
    at(70);
    button.click();
    expect(seeks).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('player_audio_dip', { down: true, ms: FADE_OUT_MS });
    vi.advanceTimersByTime(FADE_OUT_MS);
    expect(seeks).toEqual([150]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('is an instant jump with Reduce motion on', async () => {
    saved.set(SMOOTH_SKIP_KEY, true);
    motion.reduced = true;
    const { seeks, at } = await setup({ modes: MODES({ intro: 'auto' }) });
    at(70);
    expect(seeks).toEqual([150]);
    expect(toast).toHaveBeenCalledWith('player.skip.skipped-intro');
  });
});

describe('times from TheIntroDB', () => {
  it('asks for the episode by IMDb id, season and number', async () => {
    const { skip } = await setup({ lookup: true, chapters: false });
    skip.newTitle(series('tt123'), episode(2, 5));
    expect(invoke).toHaveBeenCalledWith('skip_segments', { imdbId: 'tt123', season: 2, episode: 5 });
  });

  it('doesn’t ask for specials, or with the lookup off', async () => {
    const { skip } = await setup({ lookup: true, chapters: false });
    skip.newTitle(series('tt123'), episode(0, 1));
    skip.configure({ lookup: false, modes: MODES(), learn: false });
    skip.newTitle(series('tt123'), episode(1, 1));
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'skip_segments')).toEqual([]);
  });

  it('uses the times once they arrive', async () => {
    lookups.set('tt1', Promise.resolve([{ kind: 'intro', start: 30, end: 90 }]));
    const { skip, button, at } = await setup({ lookup: true, chapters: false });
    skip.newTitle(series('tt1'), episode(1, 1));
    await vi.advanceTimersByTimeAsync(0);
    at(40);
    expect(button.hidden).toBe(false);
  });

  it('ignores an answer for the title before', async () => {
    let answer!: (found: unknown) => void;
    lookups.set('tt1', new Promise((resolve) => (answer = resolve)));
    lookups.set('tt2', Promise.resolve([]));
    const { skip, button, at } = await setup({ lookup: true, chapters: false });
    skip.newTitle(series('tt1'), episode(1, 1));
    skip.newTitle(series('tt2'), episode(1, 1));
    answer([{ kind: 'intro', start: 30, end: 90 }]);
    await vi.advanceTimersByTimeAsync(0);
    at(40);
    expect(button.hidden).toBe(true);
  });
});

describe('learned intros', () => {
  const INTRO: Intro = { start: 40, end: 100 };

  it('offers the series’ learned intro, but never skips it without asking', async () => {
    learned.set('tt9', INTRO);
    const { skip, button, seeks, at } = await setup({ modes: MODES({ intro: 'auto' }), learn: true, chapters: false });
    skip.newTitle(series('tt9'), episode(1, 2));
    // An IMDb id is also asked of AniSkip (off here): the learned intro waits for that answer.
    await vi.advanceTimersByTimeAsync(0);
    at(50);
    expect(button.hidden).toBe(false);
    expect(seeks).toEqual([]);
  });

  it('waits for TheIntroDB before offering it', async () => {
    learned.set('tt9', INTRO);
    lookups.set('tt9', new Promise(() => {}));
    const { skip, button, at } = await setup({ learn: true, lookup: true, chapters: false });
    skip.newTitle(series('tt9'), episode(1, 2));
    await vi.advanceTimersByTimeAsync(0);
    at(50);
    expect(button.hidden).toBe(true);
  });

  it('isn’t offered for specials', async () => {
    learned.set('tt9', INTRO);
    const { skip, button, at } = await setup({ learn: true, chapters: false });
    skip.newTitle(series('tt9'), episode(0, 2));
    at(50);
    expect(button.hidden).toBe(true);
  });

  it('learns an intro skipped with the button', async () => {
    const { skip, button, at } = await setup({ learn: true });
    skip.newTitle(series('tt9'), episode(1, 1));
    at(70);
    button.click();
    expect(learnt).toEqual([['tt9', { start: 60, end: 150 }]]);
  });

  it('learns a forward seek near the start once it settles', async () => {
    const { skip, at } = await setup({ learn: true, chapters: false });
    skip.newTitle(series('tt9'), episode(1, 1));
    at(45);
    skip.userSeek({ by: 30 });
    skip.userSeek({ by: 30 });
    expect(learnt).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(learnt).toEqual([['tt9', { start: 45, end: 105 }]]);
  });
});
