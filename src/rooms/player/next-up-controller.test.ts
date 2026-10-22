import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { EpisodeRef } from '../detail/title-actions';
import type { PlayRequest } from './index';
import type { UpNext } from './next-up';
import type { PlayableSource } from './panels';

/** Just enough of an element for the Next Up card and "Still watching?". */
class FakeEl extends EventTarget {
  children: (FakeEl | string)[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  focused = false;
  classes = new Set<string>();
  classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    toggle: (name: string, on?: boolean) => void ((on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
  };
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    if (name === 'hidden') this.hidden = true;
    else if (name === 'class') value.split(' ').forEach((c) => this.classes.add(c));
    else this.attrs[name] = value;
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') this.textContent += node;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
  focus(): void {
    this.focused = true;
  }
  click(): void {
    this.dispatchEvent(new Event('click'));
  }
  /** Every element below this one, depth first. */
  all(): FakeEl[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]));
  }
}

const air = { exact: undefined as number | undefined };
const found = new Map<string, PlayableSource[]>();

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../components/cards', () => ({ artImage: () => new FakeEl('img') }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../library/spoilers', () => ({ hiddenFor: () => ({ thumbnail: false, title: false }) }));
vi.mock('../../library/watch', () => ({ episodeState: () => ({ kind: 'up-next' }) }));
vi.mock('../../library/jellyfin', () => ({ isJellyfinId: () => false }));
vi.mock('../../library/plex', () => ({ isPlexId: () => false }));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: () => 'en' }));
vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string | boolean> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== false) el.setAttribute(name, value === true ? '' : value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../../lib/platform', () => ({ isAndroid: false }));
vi.mock('../../theme/appearance', () => ({ reducedMotion: () => false }));
vi.mock('../../catalog/air-times', () => ({ exactAirTime: () => air.exact, loadAirTimes: async () => {} }));
vi.mock('../detail/queue-actions', () => ({ queueTarget: vi.fn() }));
vi.mock('../detail/streams', () => ({
  openStreams: vi.fn(),
  resolveSources: vi.fn(async (_title: Title, episode: EpisodeRef) => found.get(episode.episode.id) ?? []),
}));
vi.mock('./failed-sources', () => ({ failedRecently: () => () => false, whereKey: (a: string, b = '') => `${a}/${b}` }));
vi.mock('./panels', () => ({ upNextName: (next: UpNext) => (next.kind === 'episode' ? `E${next.episode.episode.number}` : next.item.title.name) }));

const { invoke } = await import('@tauri-apps/api/core');
const { openStreams, resolveSources } = await import('../detail/streams');
const { queueTarget } = await import('../detail/queue-actions');
const { createNextUp } = await import('./next-up-controller');
const { creditsStarted, leavesFinished } = await import('./end-screen-rules');
const { leftAt } = await import('./next-up');

const DURATION = 1500;
/** Credits known from here: the countdown runs at once (with them unknown it holds until it would end at the episode's end). */
const CREDITS = 1400;
const show = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] } as unknown as Title;
const ep = (number: number, released = '2020-01-01'): EpisodeRef => ({ season: 1, episode: { id: `tt1:1:${number}`, number, title: `Episode ${number}`, released } });
const source = (id: string, addon: string, label = '1080p'): PlayableSource => ({ id, url: `https://example.test/${id}`, addon, label, meta: '' });

type Played = { request: PlayRequest; finished: boolean };

/** The player as Next Up sees it: mpv's position and pause, reported by `at` (an mpv event). */
function setup(options: { next?: EpisodeRef | null; blocked?: boolean; credits?: number } = {}) {
  const state = { timePos: null as number | null, duration: DURATION as number | null, paused: false, started: true, panelOpen: false, closed: false };
  let playing = ep(1);
  let following: EpisodeRef | null = options.next === undefined ? ep(2) : options.next;
  const current = source('a1', 'Addon A');
  const played: Played[] = [];
  const host = {
    ctx: {} as never,
    request: () => ({ title: show, episode: playing, source: current, sources: [current] }) as unknown as PlayRequest,
    status: () => ({ timePos: state.timePos, duration: state.duration, paused: state.paused }),
    started: () => state.started,
    closed: () => state.closed,
    upNext: (): UpNext | undefined => (following ? { kind: 'episode', episode: following } : undefined),
    segments: () => (options.credits === undefined ? [] : [{ kind: 'credits' as const, start: options.credits, end: DURATION }]),
    panelOpen: () => state.panelOpen,
    blocked: () => options.blocked ?? false,
    play: (request: PlayRequest, finished: boolean) => void played.push({ request, finished }),
    shuffling: () => false,
    pause: vi.fn(),
    back: vi.fn(),
  };
  const nextUp = createNextUp(host);
  nextUp.configure({ mode: 'always', countdown: 10, limit: 0 });
  const card = nextUp.element as unknown as FakeEl;
  const label = card.all().find((el) => el.classes.has('next-up-label'))!;
  const [playButton, cancelButton] = card.all().filter((el) => el.tag === 'button');
  const at = (seconds: number | null, atEnd = false) => {
    state.timePos = seconds;
    nextUp.update(atEnd);
  };
  /** The episode that just started becomes the one playing (as the player does), at its start. */
  const advance = () => {
    playing = following!;
    following = ep(playing.episode.number + 1);
    nextUp.reset();
    at(0);
  };
  return { nextUp, host, state, card, label, playButton: playButton!, cancelButton: cancelButton!, played, at, advance, setNext: (next: EpisodeRef | null) => (following = next) };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 5, 1).getTime() });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', new EventTarget());
  air.exact = undefined;
  found.clear();
  found.set('tt1:1:2', [source('b1', 'Addon B'), source('a2', 'Addon A')]);
  found.set('tt1:1:3', [source('a3', 'Addon A')]);
  found.set('tt1:1:4', [source('a4', 'Addon A')]);
  vi.mocked(invoke).mockClear();
  vi.mocked(openStreams).mockClear();
  vi.mocked(resolveSources).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('when the Next Up card appears', () => {
  it('appears once mpv reports 94% played, not before', () => {
    const { nextUp, card, at } = setup();
    at(1400);
    expect(card.hidden).toBe(true);
    at(1410);
    expect(card.hidden).toBe(false);
    expect(nextUp.shown()).toBe(true);
  });

  it('waits for the file’s first frame', () => {
    const { state, card, at } = setup();
    state.started = false;
    at(1450);
    expect(card.hidden).toBe(true);
    state.started = true;
    at(1450);
    expect(card.hidden).toBe(false);
  });

  it('doesn’t appear with nothing next, or with autoplay blocked', () => {
    const none = setup({ next: null });
    none.at(1450);
    expect(none.card.hidden).toBe(true);
    const blocked = setup({ blocked: true });
    blocked.at(1450);
    expect(blocked.card.hidden).toBe(true);
  });

  it('appears at the credits’ start when they are known, and moves the picture into the corner', () => {
    const { card, at } = setup({ credits: 1300 });
    at(1290);
    expect(card.hidden).toBe(true);
    at(1300);
    expect(card.hidden).toBe(false);
    expect(card.classes.has('takeover')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('player_set_corner', { on: true });
  });

  it('gives the picture its place back when the viewer seeks out of the credits', () => {
    const { card, at } = setup({ credits: 1450 });
    at(1460);
    expect(card.classes.has('takeover')).toBe(true);
    // Still past where the card appears, but before the credits.
    at(1420);
    expect(card.hidden).toBe(false);
    expect(card.classes.has('takeover')).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('player_set_corner', { on: false });
  });

  it('goes when the viewer seeks back to before where it appears, and comes back there', () => {
    const { card, at } = setup();
    at(1450);
    at(600);
    expect(card.hidden).toBe(true);
    at(1450);
    expect(card.hidden).toBe(false);
  });

  it('stays away for the episode once cancelled', () => {
    const { nextUp, card, cancelButton, at } = setup();
    at(1450);
    cancelButton.click();
    expect(card.hidden).toBe(true);
    expect(nextUp.dismissed()).toBe(true);
    at(1460);
    expect(card.hidden).toBe(true);
  });

  it('isn’t offered for an episode whose exact air time is still to come', () => {
    air.exact = Date.now() + 3_600_000;
    const { card, at } = setup();
    at(1450);
    expect(card.hidden).toBe(true);
  });
});

describe('the countdown', () => {
  it('counts down each second, then plays the next episode on the same addon', async () => {
    const { label, played, at } = setup({ credits: CREDITS });
    at(1450);
    expect(label.textContent).toBe('player.next-up.countdown {"seconds":10}');
    await vi.advanceTimersByTimeAsync(3000);
    expect(label.textContent).toBe('player.next-up.countdown {"seconds":7}');
    await vi.advanceTimersByTimeAsync(7000);
    expect(played).toHaveLength(1);
    expect(played[0]!.request.source.id).toBe('a2');
    expect(played[0]!.request.episode?.episode.id).toBe('tt1:1:2');
    expect(played[0]!.finished).toBe(true);
  });

  it('says when what it counts down to comes from the queue, not the series', () => {
    const film = { id: 'tt9', type: 'movie', name: 'Film', genres: [], origins: [] } as unknown as Title;
    vi.mocked(queueTarget).mockResolvedValue({ title: film, episode: undefined } as never);
    const { host, label, at } = setup({ credits: CREDITS });
    host.upNext = () => ({ kind: 'queue', item: { id: 'q1', title: film, episode: null, addedAt: 0 } });
    at(1450);
    expect(label.textContent).toBe('watching.queue.from-queue · player.next-up.countdown {"seconds":10}');
  });

  it('holds while paused and while a panel is open', async () => {
    const { state, label, played, at } = setup({ credits: CREDITS });
    at(1450);
    state.paused = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(label.textContent).toContain('"seconds":10');
    state.paused = false;
    state.panelOpen = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(played).toHaveLength(0);
    state.panelOpen = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(1);
  });

  it('goes on once the episode has ended, though mpv holds the last frame paused', async () => {
    const { state, played, at } = setup();
    at(1450);
    state.paused = true;
    at(DURATION, true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(1);
  });

  it('holds again once the viewer seeks back from the end and pauses', async () => {
    const { state, played, at } = setup();
    at(DURATION, true);
    at(1450);
    state.paused = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(played).toHaveLength(0);
  });

  it('doesn’t count down when set to Ask', async () => {
    const { nextUp, label, played, at } = setup();
    nextUp.configure({ mode: 'ask' });
    at(1450);
    expect(label.textContent).toBe('player.next-up.label');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(played).toHaveLength(0);
  });

  it('doesn’t count down to an episode that may not have aired, but plays it when asked', async () => {
    const { label, playButton, played, at, setNext } = setup();
    setNext(ep(2, '2026-12-01'));
    at(1450);
    expect(label.textContent).toBe('sources.next-up.unaired');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(played).toHaveLength(0);
    playButton.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toHaveLength(1);
  });

  it('doesn’t count down to an episode with no air date', async () => {
    const { label, at, setNext } = setup();
    setNext({ season: 1, episode: { id: 'tt1:1:2', number: 2, title: '' } });
    at(1450);
    expect(label.textContent).toBe('sources.next-up.unaired');
  });

  it('opens the picker when the next episode has no source', async () => {
    found.delete('tt1:1:2');
    const { card, played, at } = setup({ credits: CREDITS });
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(0);
    expect(openStreams).toHaveBeenCalledOnce();
    expect(card.hidden).toBe(true);
  });

  it('gives up a Play Next still finding sources when another file starts', async () => {
    let answer!: (sources: PlayableSource[]) => void;
    vi.mocked(resolveSources).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { nextUp, played, at } = setup();
    at(1450);
    void nextUp.playNext(false, true);
    nextUp.reset();
    answer([source('a2', 'Addon A')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toHaveLength(0);
  });

  it('doesn’t come back and count down again to what the profile’s limit refused', async () => {
    const { nextUp, card, played, at } = setup({ credits: CREDITS });
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(1);
    // The player turns it down and goes on with this file's credits.
    nextUp.refused();
    at(1460);
    await vi.advanceTimersByTimeAsync(20_000);
    at(1480);
    expect(card.hidden).toBe(true);
    expect(played).toHaveLength(1);
  });
});

describe('Still watching?', () => {
  it('asks after the chosen number of episodes in a row, pausing instead of playing on', async () => {
    const { nextUp, host, played, at, advance } = setup({ credits: CREDITS });
    nextUp.configure({ limit: 2 });
    for (let i = 0; i < 2; i++) {
      at(1450);
      await vi.advanceTimersByTimeAsync(10_000);
      advance();
    }
    expect(played).toHaveLength(2);
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(2);
    expect(nextUp.asking()).toBe(true);
    expect(host.pause).toHaveBeenCalledOnce();
    expect((nextUp.prompt as unknown as FakeEl).hidden).toBe(false);
  });

  it('starts the count again after a key or click in the player', async () => {
    const { nextUp, played, at, advance } = setup({ credits: CREDITS });
    nextUp.configure({ limit: 2 });
    for (let i = 0; i < 2; i++) {
      at(1450);
      await vi.advanceTimersByTimeAsync(10_000);
      advance();
    }
    nextUp.interacted();
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(3);
    expect(nextUp.asking()).toBe(false);
  });

  it('plays on from its Continue button', async () => {
    const { nextUp, played, at, advance } = setup({ credits: CREDITS });
    nextUp.configure({ limit: 1 });
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    advance();
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(nextUp.asking()).toBe(true);
    const keepOn = (nextUp.prompt as unknown as FakeEl).all().find((el) => el.tag === 'button')!;
    keepOn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(nextUp.asking()).toBe(false);
    expect(played).toHaveLength(2);
    // Started by the viewer: not an automatic one.
    expect(played[1]!.finished).toBe(true);
  });

  it('leaving from its Back button counts the episode as watched, as playing on would have', async () => {
    // Credits known to start after the card comes (94 %): leaving there is only "finished" because of the prompt.
    const { nextUp, host, played, at, advance } = setup({ credits: 1480 });
    nextUp.configure({ limit: 1 });
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    advance();
    expect(nextUp.leftAsked()).toBe(false);
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(nextUp.asking()).toBe(true);
    const leave = (nextUp.prompt as unknown as FakeEl).all().filter((el) => el.tag === 'button')[1]!;
    leave.click();
    expect(host.back).toHaveBeenCalledOnce();
    expect(played).toHaveLength(1);
    expect(leftAt(1450, DURATION, leavesFinished(nextUp.leftAsked(), false, creditsStarted(host.segments(), 1450)))).toBe(DURATION);
    // The next file is someone else's choice again.
    nextUp.reset();
    expect(nextUp.leftAsked()).toBe(false);
  });
});

describe('finding the next episode’s sources early', () => {
  it('asks the addons once, 60% in, and plays from what was found', async () => {
    const { played, at } = setup({ credits: CREDITS });
    at(800);
    expect(resolveSources).not.toHaveBeenCalled();
    at(900);
    at(950);
    expect(resolveSources).toHaveBeenCalledOnce();
    at(1450);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(played).toHaveLength(1);
    expect(resolveSources).toHaveBeenCalledOnce();
  });

  it('doesn’t ask before the autoplay setting is known (it may be off)', () => {
    const unconfigured = createNextUp(bareHost());
    unconfigured.update();
    expect(resolveSources).not.toHaveBeenCalled();
    unconfigured.configure({ mode: 'always' });
    unconfigured.update();
    expect(resolveSources).toHaveBeenCalledOnce();
  });

  it('doesn’t ask while autoplay is blocked', () => {
    const { at } = setup({ blocked: true });
    at(900);
    expect(resolveSources).not.toHaveBeenCalled();
  });
});

/** A host 60% into episode 1, for a controller built without `configure` (the mode not read yet). */
function bareHost() {
  const current = source('a1', 'Addon A');
  return {
    ctx: {} as never,
    request: () => ({ title: show, episode: ep(1), source: current, sources: [current] }) as unknown as PlayRequest,
    status: () => ({ timePos: 900, duration: DURATION, paused: false }),
    started: () => true,
    closed: () => false,
    upNext: (): UpNext => ({ kind: 'episode', episode: ep(2) }),
    segments: () => [],
    panelOpen: () => false,
    blocked: () => false,
    play: () => {},
    shuffling: () => false,
    pause: () => {},
    back: () => {},
  };
}
