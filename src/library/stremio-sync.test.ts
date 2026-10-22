import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import { checkStremioAccount, fitBytes, movieImport, patchFor, seriesImport, startStremioSync, stremioSyncState, syncNow, type StremioItem } from './stremio-sync';
import { continueWatching, episodeState, historyRows, importWatch, isWatched, loadWatch, recordProgress, removeHistory, setEpisodesWatched } from './watch';
import { decodeWatched, encodeWatched, videoOrder } from './watched-bitfield';

const mocked = vi.mocked(invoke);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3), ep(4)] }] };
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
const AT = Date.parse('2026-10-01T12:00:00Z');

const item = (over: Partial<Omit<StremioItem, 'state'>> & { state?: Partial<StremioItem['state']> }): StremioItem => ({
  _id: 'tt1',
  type: 'movie',
  name: 'Film',
  poster: null,
  ...over,
  state: { lastWatched: '2026-10-01T12:00:00Z', timeOffset: 0, duration: 0, video_id: null, timesWatched: 0, watched: null, ...over.state },
});

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('bringing in Stremio progress', () => {
  it('a movie part way through lands in Continue Watching, at Stremio’s time', async () => {
    importWatch(...movieImport(item({ state: { timeOffset: 1_800_000, duration: 6_000_000 } })), AT);
    expect(continueWatching()).toEqual([expect.objectContaining({ title: expect.objectContaining({ id: 'tt1' }), left: '70m left' })]);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ at: AT })));
  });

  it('never unmarks a movie Orbit has as watched', () => {
    importWatch(movie, [{ videoId: 'tt1', titleId: 'tt1', season: null, episode: null, position: 0, duration: 6000, watched: true, updatedAt: 0 }], { next: null, completed: true }, AT - 1);
    importWatch(...movieImport(item({ state: { timesWatched: 0, timeOffset: 0 } })), AT);
    expect(isWatched(movie)).toBe(true);
  });

  it('a series brings watched episodes and the next one up', () => {
    const one = ep(1);
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:3', timeOffset: 1 } }), show, new Set([one.id, 'tt9:1:2'])), AT);
    expect(episodeState(show, 1, one).kind).toBe('watched');
    expect(episodeState(show, 1, ep(3)).kind).toBe('up-next');
    expect(continueWatching()[0]).toEqual(expect.objectContaining({ badge: 'Next episode' }));
  });

  it('taking a series out of Continue Watching in Stremio does the same here', () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 2400);
    expect(continueWatching()).toHaveLength(1);
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:2', timeOffset: 0 } }), show, new Set()), Date.now() + 5000);
    expect(continueWatching()).toEqual([]);
  });

  it('an episode Orbit doesn’t know in progress in Stremio leaves Continue Watching alone', () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 2400);
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:2:1', timeOffset: 300_000 } }), show, new Set()), Date.now() + 5000);
    expect(continueWatching()).toHaveLength(1);
  });
});

describe('sending progress to Stremio', () => {
  it('a movie in progress', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    expect(await patchFor(movie)).toEqual(expect.objectContaining({ id: 'tt1', videoId: 'tt1', timeOffset: 1_800_000, duration: 6_000_000, watched: null }));
  });

  it('a series: the next episode as offset 1, and every watched episode in the field', async () => {
    setEpisodesWatched(show, [{ season: 1, episode: ep(1) }, { season: 1, episode: ep(2) }], true);
    const patch = await patchFor(show);
    expect(patch).toEqual(expect.objectContaining({ videoId: 'tt9:1:3', timeOffset: 1, watched: null }));
    expect([...(await decodeWatched(patch!.watchedField as string, videoOrder(show)))]).toEqual(['tt9:1:1', 'tt9:1:2']);
  });

  it('a long name is cut to what Stremio takes, between characters', async () => {
    const long: Title = { ...movie, id: 'tt2', name: '名'.repeat(300) };
    recordProgress(long, undefined, 1800, 6000);
    const name = (await patchFor(long))!.name as string;
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(500);
    expect(name).toBe('名'.repeat(166));
    expect(fitBytes('aé', 2)).toBe('a');
    expect(fitBytes('Film', 500)).toBe('Film');
  });

  it('keeps episodes marked watched on other devices: Orbit’s marks are added to Stremio’s', async () => {
    setEpisodesWatched(show, [{ season: 1, episode: ep(1) }], true);
    const remote = await encodeWatched(new Set(['tt9:1:3']), videoOrder(show));
    const patch = await patchFor(show, remote);
    expect([...(await decodeWatched(patch!.watchedField as string, videoOrder(show)))]).toEqual(['tt9:1:1', 'tt9:1:3']);
    // Sent with what it was merged with, so Rust can tell if Stremio's changed since.
    expect(patch!.watchedBase).toBe(remote);
  });

  it('a Stremio field that doesn’t line up with Orbit’s episodes is left as it is', async () => {
    setEpisodesWatched(show, [{ season: 1, episode: ep(1) }], true);
    const remote = await encodeWatched(new Set(['other:1']), ['other:1']);
    expect(await patchFor(show, remote)).toEqual(expect.objectContaining({ watchedField: null }));
  });

  it('a watched field Stremio can’t take is left out, not the whole title', async () => {
    const odd: Title = { ...show, id: 'odd', seasons: [{ number: 1, episodes: [{ id: 'odd 1', number: 1, title: 'One' }, { id: 'odd 2', number: 2, title: 'Two' }] }] };
    setEpisodesWatched(odd, [{ season: 1, episode: odd.seasons![0]!.episodes[0]! }], true);
    expect(await patchFor(odd)).toEqual(expect.objectContaining({ id: 'odd', videoId: 'odd 2', watchedField: null }));
  });
});

describe('two parts under one episode number', () => {
  it('Stremio finishing Part 2 brings in the episode after it as next, not Part 2 again', () => {
    const parts: Title = { ...show, seasons: [{ number: 1, episodes: [ep(1), { id: 'tt9:1:2a', number: 2, title: 'Part 1' }, { id: 'tt9:1:2b', number: 2, title: 'Part 2' }, ep(3), ep(4)] }] };
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:2b', timeOffset: 2_300_000, duration: 2_400_000 } }), parts, new Set(['tt9:1:1', 'tt9:1:2a'])), AT);
    expect(episodeState(parts, 1, ep(3)).kind).toBe('up-next');
    expect(isWatched(parts)).toBe(false);
  });
});

describe('watching again', () => {
  const all = [1, 2, 3, 4].map((n) => ({ season: 1, episode: ep(n) }));

  it('a movie rewatched part way is sent as watched, with where it is', async () => {
    recordProgress(movie, undefined, 5800, 6000);
    recordProgress(movie, undefined, 600, 6000);
    expect(await patchFor(movie)).toEqual(expect.objectContaining({ timeOffset: 600_000, watched: true }));
  });

  it('an episode rewatched part way stays in the watched field', async () => {
    setEpisodesWatched(show, all, true);
    // Later than the marks, so it's the latest row.
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 2400);
    later.mockRestore();
    const patch = await patchFor(show);
    expect(patch).toEqual(expect.objectContaining({ videoId: 'tt9:1:2', timeOffset: 600_000 }));
    expect([...(await decodeWatched(patch!.watchedField as string, videoOrder(show)))]).toEqual(['tt9:1:1', 'tt9:1:2', 'tt9:1:3', 'tt9:1:4']);
  });

  it('a rewatch stopped past 80% in Stremio keeps the show in Continue Watching, at the episode it names', () => {
    setEpisodesWatched(show, all, true);
    recordProgress(show, { season: 1, episode: ep(1) }, 1550, 1600);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: 'S1 · E2 · Episode 2' })]);
    // Stopped at 85% of E2 (as watch.ts keeps the show listed when played here): the pull mustn't hide it.
    const watched = new Set(all.map((ref) => ref.episode.id));
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:2', timeOffset: 1_360_000, duration: 1_600_000 } }), show, watched), Date.now() + 5000);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: 'S1 · E2 · Episode 2' })]);
    expect(isWatched(show)).toBe(true);
  });

  it('a rewatch brought in from Stremio keeps the episode watched and the show finished', () => {
    setEpisodesWatched(show, all, true);
    const watched = new Set(all.map((ref) => ref.episode.id));
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:2', timeOffset: 600_000, duration: 2_400_000 } }), show, watched), Date.now() + 5000);
    expect(episodeState(show, 1, ep(2)).kind).toBe('watched');
    expect(isWatched(show)).toBe(true);
    importWatch(...seriesImport(item({ _id: 'tt9', type: 'series', state: { video_id: 'tt9:1:3', timeOffset: 1 } }), show, watched), Date.now() + 10000);
    expect(isWatched(show)).toBe(true);
  });
});

describe('syncing', () => {
  it('a sync asked for while one is running shares it instead of pulling again', async () => {
    let release!: (items: unknown[]) => void;
    mocked.mockImplementation((cmd) => (cmd === 'stremio_library_pull' ? new Promise((resolve) => (release = resolve)) : Promise.resolve(undefined)));
    const first = syncNow();
    const second = syncNow();
    release([]);
    expect(await Promise.all([first, second])).toEqual([0, 0]);
    expect(mocked.mock.calls.filter(([cmd]) => cmd === 'stremio_library_pull')).toHaveLength(1);
    // Once it's done, the next one pulls again.
    const third = syncNow();
    release([]);
    await third;
    expect(mocked.mock.calls.filter(([cmd]) => cmd === 'stremio_library_pull')).toHaveLength(2);
  });
});

describe('the account check in Settings', () => {
  it('a failed check is “unreachable”, and leaves what’s known about the account alone', async () => {
    mocked.mockImplementation(async (cmd) => (cmd === 'stremio_library_pull' ? [] : undefined));
    await syncNow();
    const before = stremioSyncState();
    expect(before.signedIn).toBe(true);
    // Tauri rejects with the Rust command's error string as-is.
    mocked.mockImplementation((cmd) => (cmd === 'stremio_account' ? Promise.reject('err.stremio.unreachable') : Promise.resolve(undefined)));
    expect(await checkStremioAccount()).toBe('unreachable');
    expect(stremioSyncState()).toBe(before);
    mocked.mockImplementation(async (cmd) => (cmd === 'stremio_account' ? null : undefined));
    expect(await checkStremioAccount()).toBeNull();
  });

  it('any other failure is signed out, so Sign in is offered instead of Try again forever', async () => {
    for (const err of ['err.stremio.invalid', 'Couldn’t read the keychain.', 'Invalid session', 'Stremio didn’t accept that.']) {
      mocked.mockImplementation((cmd) => (cmd === 'stremio_account' ? Promise.reject(err) : Promise.resolve(undefined)));
      expect(await checkStremioAccount()).toBeNull();
    }
  });
});

describe('history cleared in Orbit', () => {
  it('stays cleared: a pull skips what Stremio watched before, and nothing is sent', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    await removeHistory(movie.id);
    const pulled = (lastWatched: string) => mocked.mockImplementation(async (cmd) => (cmd === 'stremio_library_pull' ? [item({ state: { lastWatched, timeOffset: 1_800_000, duration: 6_000_000 } })] : undefined));
    pulled(new Date(Date.now() - 60_000).toISOString());
    expect(await syncNow()).toBe(0);
    expect(historyRows()).toEqual([]);
    expect(mocked).not.toHaveBeenCalledWith('stremio_library_push', expect.anything());
    // Watched in Stremio after the clear: that comes in as usual.
    pulled(new Date(Date.now() + 60_000).toISOString());
    expect(await syncNow()).toBe(1);
    expect(historyRows()).toHaveLength(1);
  });
});

// Runs last: the push listener it starts stays for the rest of the file.
describe('pushing', () => {
  // Started once, by whichever test runs first: a second start would add a second listener, and each
  // test here needs it running (and the first pull done) whatever order the tests run in.
  let started: Promise<void> | null = null;
  beforeEach(async () => {
    vi.stubGlobal('window', globalThis);
    vi.useFakeTimers();
    mocked.mockImplementation(async (cmd) => (cmd === 'stremio_library_pull' ? [] : undefined));
    await (started ??= startStremioSync());
  });
  afterEach(() => vi.useRealTimers());

  it('sends a long backlog in batches Rust takes, and sends again only the batch that failed', async () => {
    const films = Array.from({ length: 120 }, (_, i): Title => ({ ...movie, id: `tt${1000 + i}`, name: `Film ${i}` }));
    let calls = 0;
    const sent: string[][] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd !== 'stremio_library_push') return undefined;
      const ids = (args as { patches: { id: string }[] }).patches.map((p) => p.id);
      sent.push(ids);
      // The second batch fails (offline, say).
      if (++calls === 2) throw new Error('offline');
      return 0;
    });
    for (const film of films) recordProgress(film, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sent.map((ids) => ids.length)).toEqual([50, 50, 20]);
    // The next change sends the failed batch again, with itself; nothing else.
    recordProgress(films[0]!, undefined, 900, 6000);
    await vi.advanceTimersByTimeAsync(15_000);
    // 51 titles: two batches again.
    expect(sent.slice(3).map((ids) => ids.length)).toEqual([50, 1]);
    expect(new Set(sent.slice(3).flat())).toEqual(new Set([...sent[1]!, films[0]!.id]));
  });

  it('reads Stremio’s watched fields first and merges with them', async () => {
    const remote = await encodeWatched(new Set(['tt9:1:4']), videoOrder(show));
    const sent: Record<string, unknown>[] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === 'stremio_library_watched') return { tt9: remote };
      if (cmd === 'stremio_library_push') sent.push(...(args as { patches: Record<string, unknown>[] }).patches);
      return cmd === 'stremio_library_push' ? 0 : undefined;
    });
    setEpisodesWatched(show, [{ season: 1, episode: ep(2) }], true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocked).toHaveBeenCalledWith('stremio_library_watched', { ids: ['tt9'] });
    // (Compression runs off the fake clock.)
    const patch = await vi.waitFor(() => {
      const found = sent.find((p) => p.id === 'tt9');
      if (!found) throw new Error('not sent yet');
      return found;
    });
    expect([...(await decodeWatched(patch.watchedField as string, videoOrder(show)))]).toEqual(['tt9:1:2', 'tt9:1:4']);
  });

  it('notes a sync only when something was sent', async () => {
    let skipAll = true;
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd !== 'stremio_library_push') return undefined;
      const count = (args as { patches: unknown[] }).patches.length;
      return skipAll ? count : 0;
    });
    const before = stremioSyncState().lastSync;
    recordProgress({ ...movie, id: 'tt2000' }, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(15_000);
    // Rust left every title out: nothing reached Stremio.
    expect(stremioSyncState().lastSync).toBe(before);
    skipAll = false;
    recordProgress({ ...movie, id: 'tt2001' }, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(stremioSyncState().lastSync).toBeGreaterThan(before ?? 0);
  });
});
