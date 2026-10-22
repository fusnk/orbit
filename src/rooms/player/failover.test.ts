import { describe, expect, it, vi } from 'vitest';

// Only the length check is under test; the rest needs a page.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('./next-up', () => ({ nextSource: vi.fn() }));

import type { Title } from '../../catalog/titles';
import { createEarlyStopRetry, createLiveReconnect, EARLY_RETRY_RESET_S, endedEarly, endOfFile, LIVE_RECONNECT_WINDOW_MS, LIVE_RECONNECTS, looksLikePlaceholder } from './failover';

const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
const episode = { season: 1, episode: { id: 'tt2:1:1', number: 1, title: 'Pilot' } };

describe('debrid placeholders', () => {
  it('takes a clip of seconds for a placeholder, not the movie or episode', () => {
    expect(looksLikePlaceholder({ title: movie }, 30)).toBe(true);
    expect(looksLikePlaceholder({ title: { ...movie, type: 'series' }, episode }, 30)).toBe(true);
  });

  it('accepts real lengths', () => {
    expect(looksLikePlaceholder({ title: movie }, 7200)).toBe(false);
    expect(looksLikePlaceholder({ title: { ...movie, type: 'series' }, episode }, 90)).toBe(false);
  });

  it('trusts a runtime that says the title really is that short', () => {
    expect(looksLikePlaceholder({ title: { ...movie, runtime: '3 min' } }, 170)).toBe(false);
    expect(looksLikePlaceholder({ title: { ...movie, runtime: '120 min' } }, 170)).toBe(true);
  });

  it('leaves live TV, catch-up, trailers and unknown lengths alone', () => {
    expect(looksLikePlaceholder({ title: movie, live: true } as never, 10)).toBe(false);
    expect(looksLikePlaceholder({ title: movie, trailer: true } as never, 10)).toBe(false);
    expect(looksLikePlaceholder({ title: movie }, 0)).toBe(false);
  });

  it('a placeholder no other source replaced ends as one: not the end of the movie or episode', () => {
    const web = { title: movie, source: { url: 'https://debrid.example/placeholder.mp4' } };
    // Played out to its last second: nothing is marked watched and nothing plays next.
    expect(endOfFile(web, true, 30, 30)).toBe('placeholder');
    expect(endOfFile(web, false, 7200, 7200)).toBe('done');
    expect(endOfFile(web, false, 2400, 7200)).toBe('early');
  });
});

describe('a stream that ends early', () => {
  const web = { title: movie, source: { url: 'https://cdn.example/film.mkv' } };

  it('takes an end well before the length for a dropped stream', () => {
    expect(endedEarly(web, 2400, 7200)).toBe(true);
    expect(endedEarly(web, 6000, 7200)).toBe(true);
  });

  it('takes an end in the last stretch (credits) as the real end', () => {
    expect(endedEarly(web, 6200, 7200)).toBe(false);
    expect(endedEarly(web, 7199, 7200)).toBe(false);
  });

  it('leaves live TV, catch-up, trailers, files on this PC, downloads and unknown lengths alone', () => {
    expect(endedEarly({ ...web, live: true }, 10, 7200)).toBe(false);
    expect(endedEarly({ ...web, replay: true }, 10, 7200)).toBe(false);
    expect(endedEarly({ ...web, trailer: true }, 10, 7200)).toBe(false);
    expect(endedEarly({ ...web, local: true }, 10, 7200)).toBe(false);
    expect(endedEarly({ ...web, source: { url: 'orbit-download:abc' } }, 10, 7200)).toBe(false);
    expect(endedEarly(web, 10, null)).toBe(false);
    expect(endedEarly(web, null, 7200)).toBe(false);
  });
});

describe('reopening a stream that stopped early', () => {
  const film = 'tt1/\nhttps://cdn.example/film.mkv';

  it('reopens once, and gives up on a second stop soon after', () => {
    const retry = createEarlyStopRetry();
    expect(retry.reopen(film, 1800)).toBe(true);
    expect(retry.reopen(film, 1800)).toBe(false);
    expect(retry.reopen(film, 1800 + EARLY_RETRY_RESET_S - 1)).toBe(false);
  });

  it('reopens again after a long stretch of healthy playback past the last reopen', () => {
    const retry = createEarlyStopRetry();
    expect(retry.reopen(film, 1800)).toBe(true);
    expect(retry.reopen(film, 1800 + EARLY_RETRY_RESET_S)).toBe(true);
    // That reopen is the new starting point.
    expect(retry.reopen(film, 1800 + EARLY_RETRY_RESET_S + 60)).toBe(false);
  });

  it('keeps each title, episode and source to itself', () => {
    const retry = createEarlyStopRetry();
    expect(retry.reopen(film, 1800)).toBe(true);
    expect(retry.reopen('tt1/\nhttps://other.example/film.mkv', 1800)).toBe(true);
    expect(retry.reopen('tt2/e1\nhttps://cdn.example/film.mkv', 1800)).toBe(true);
  });
});

describe('a live channel whose stream ended', () => {
  it('is reconnected a few times, then given up on until the window passes', () => {
    const live = createLiveReconnect();
    for (let i = 0; i < LIVE_RECONNECTS; i++) expect(live.reconnect('orbit-tv://a/1', i * 1000)).toBe(true);
    expect(live.reconnect('orbit-tv://a/1', 10_000)).toBe(false);
    // Minutes later the first drops no longer count.
    expect(live.reconnect('orbit-tv://a/1', LIVE_RECONNECT_WINDOW_MS + 1000)).toBe(true);
  });

  it('starts over for another channel, and after trying again by hand', () => {
    const live = createLiveReconnect();
    for (let i = 0; i < LIVE_RECONNECTS; i++) live.reconnect('orbit-tv://a/1', i);
    expect(live.reconnect('orbit-tv://a/2', 10)).toBe(true);
    for (let i = 0; i < LIVE_RECONNECTS; i++) live.reconnect('orbit-tv://a/2', 20 + i);
    live.reset();
    expect(live.reconnect('orbit-tv://a/2', 30)).toBe(true);
  });
});
