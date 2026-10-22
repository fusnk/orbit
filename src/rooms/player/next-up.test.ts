import { describe, expect, it } from 'vitest';
import type { QueueItem } from '../../library/queue';
import type { EpisodeRef } from '../detail/title-actions';
import { airedForAutoplay, askStillWatching, chooseUpNext, countdownWaits, createAutoplayChain, countdownSeconds, DEFAULT_COUNTDOWN, handsOff, leftAt, nextSource, parseAutoplayLimit, parseAutoplayMode, parseNextUpAt, parseNextUpStyle, pickNextSource, reachedNextUp, releaseGroup, sameUpNext } from './next-up';
import type { PlayableSource } from './panels';

describe('chooseUpNext', () => {
  const queued = (id: string): QueueItem => ({ id, title: { id: `tt-${id}`, type: 'movie', name: id, genres: [], origins: [] }, episode: null, addedAt: 0 });
  const following: EpisodeRef = { season: 1, episode: { id: 'tt9:1:2', number: 2, title: 'Two' } };

  it("offers the queue's first item before the next episode, and after a movie", () => {
    expect(chooseUpNext(queued('a'), following, {})).toEqual({ kind: 'queue', item: queued('a') });
    expect(chooseUpNext(queued('a'), undefined, {})).toEqual({ kind: 'queue', item: queued('a') });
  });

  it('goes on to the next episode as before when nothing is queued', () => {
    expect(chooseUpNext(undefined, following, {})).toEqual({ kind: 'episode', episode: following });
    expect(chooseUpNext(undefined, undefined, {})).toBeUndefined();
  });

  it("doesn't lead from live TV, catch-up or a trailer into the queue", () => {
    for (const playing of [{ live: true }, { replay: true }, { trailer: true }]) expect(chooseUpNext(queued('a'), undefined, playing)).toBeUndefined();
  });

  it('tells whether two choices play the same thing', () => {
    expect(sameUpNext({ kind: 'queue', item: queued('a') }, { kind: 'queue', item: queued('a') })).toBe(true);
    expect(sameUpNext({ kind: 'queue', item: queued('a') }, { kind: 'queue', item: queued('b') })).toBe(false);
    expect(sameUpNext({ kind: 'episode', episode: following }, { kind: 'episode', episode: { ...following } })).toBe(true);
    expect(sameUpNext({ kind: 'episode', episode: following }, { kind: 'queue', item: queued('a') })).toBe(false);
    expect(sameUpNext(undefined, undefined)).toBe(true);
    expect(sameUpNext({ kind: 'queue', item: queued('a') }, undefined)).toBe(false);
  });
});

const source = (id: string, addon: string, bingeGroup?: string): PlayableSource => ({ id, url: `https://x/${id}`, addon, label: '1080p', meta: '', ...(bingeGroup ? { bingeGroup } : {}) });

describe('pickNextSource', () => {
  const ranked = [source('a', 'Best'), source('b', 'Mine'), source('c', 'Mine', 'mine|1080p|en'), source('d', 'Other', 'mine|1080p|en')];

  it('keeps the same release when the addon tagged one', () => {
    expect(pickNextSource(ranked, source('x', 'Mine', 'mine|1080p|en'))?.id).toBe('c');
  });

  it('falls back to the same addon, then the best source', () => {
    expect(pickNextSource(ranked, source('x', 'Mine', 'gone'))?.id).toBe('b');
    expect(pickNextSource(ranked, source('x', 'Elsewhere'))?.id).toBe('a');
    expect(pickNextSource([], source('x', 'Mine'))).toBeUndefined();
  });

  it('stays in the same torrent when a season pack has the next episode too', () => {
    const pack = (id: string, hash: string, so: number, bingeGroup?: string): PlayableSource => ({ ...source(id, 'Torrents', bingeGroup), url: `magnet:?xt=urn:btih:${hash.repeat(40)}&so=${so}` });
    const next = [source('a', 'Best'), pack('b', 'b', 1, 'grp'), pack('c', 'c', 4)];
    expect(pickNextSource(next, { ...pack('x', 'c', 3), fileChosen: true })?.id).toBe('c');
    expect(pickNextSource(next, pack('x', 'd', 3, 'grp'))?.id).toBe('b');
    // Failed lately: the same addon's other torrent instead.
    expect(pickNextSource(next, pack('x', 'c', 3), (s) => s.id === 'c')?.id).toBe('b');
  });

  it('passes over sources that failed recently, unless nothing else is left', () => {
    expect(pickNextSource(ranked, source('x', 'Mine', 'mine|1080p|en'), (s) => s.id === 'c')?.id).toBe('d');
    expect(pickNextSource(ranked, source('x', 'Elsewhere'), (s) => s.id === 'a')?.id).toBe('b');
    expect(pickNextSource(ranked, source('x', 'Mine'), () => true)?.id).toBe('b');
  });
});

describe('pickNextSource: same quality and release group', () => {
  const file = (id: string, addon: string, label: string, filename: string): PlayableSource => ({ ...source(id, addon), label, filename });

  it("prefers the same addon's release from the same group in the same quality, then the same quality", () => {
    const next = [file('a', 'Best', '2160p', 'Show.S01E03.2160p-BIG.mkv'), file('b', 'Mine', '2160p', 'Show.S01E03.2160p-GRP.mkv'), file('c', 'Mine', '1080p', 'Show.S01E03.1080p.WEB-DL-OTHER.mkv'), file('d', 'Mine', '1080p', 'Show.S01E03.1080p.WEB-DL.x265-GRP.mkv')];
    expect(pickNextSource(next, file('x', 'Mine', '1080p', 'Show.S01E02.1080p.WEB-DL.x265-GRP.mkv'))?.id).toBe('d');
    expect(pickNextSource(next, file('x', 'Mine', '1080p', 'Show.S01E02.1080p-NOBODY.mkv'))?.id).toBe('c');
    expect(pickNextSource(next, file('x', 'Mine', '720p', 'Show.S01E02.720p-GRP.mkv'))?.id).toBe('b');
  });

  it("reads a release's group from its file name", () => {
    expect(releaseGroup('Show.S01E02.1080p.WEB-DL.x265-GROUP.mkv')).toBe('group');
    expect(releaseGroup('Movie.2024.2160p.BluRay-MiXeDGrP[site.example].mkv')).toBe('mixedgrp');
    expect(releaseGroup('Movie.2024.1080p.WEB-DL.mkv')).toBeUndefined();
    expect(releaseGroup('Movie 2024')).toBeUndefined();
    expect(releaseGroup(undefined)).toBeUndefined();
  });
});

describe('autoplay settings', () => {
  it('reads the older on/off switch and falls back to Always on junk', () => {
    expect(parseAutoplayMode(true)).toBe('always');
    expect(parseAutoplayMode(false)).toBe('never');
    expect(parseAutoplayMode('ask')).toBe('ask');
    expect(parseAutoplayMode('never')).toBe('never');
    for (const junk of [null, undefined, 0, 'Ask', {}, []]) expect(parseAutoplayMode(junk)).toBe('always');
  });

  it('offers Off, 2, 3, 4 or 5 episodes, 3 by default', () => {
    expect(parseAutoplayLimit(0)).toBe(0);
    expect(parseAutoplayLimit(2)).toBe(2);
    expect(parseAutoplayLimit(5)).toBe(5);
    // The older choice of 6 asks at 5.
    expect(parseAutoplayLimit(6)).toBe(5);
    for (const junk of [null, undefined, 1, 7, -2, '3', 1e308, Number.NaN, {}]) expect(parseAutoplayLimit(junk)).toBe(3);
  });

  it('asks "Still watching?" once the chain reaches the limit', () => {
    expect(askStillWatching(0, 2)).toBe(false);
    expect(askStillWatching(1, 2)).toBe(false);
    expect(askStillWatching(2, 2)).toBe(true);
    expect(askStillWatching(9, 3)).toBe(true);
    expect(askStillWatching(99, 0)).toBe(false);
  });

  it('counts autoplayed episodes in a row, and starts again on input or a hand-picked episode', () => {
    const chain = createAutoplayChain();
    chain.played(true);
    chain.played(true);
    expect(chain.shouldAsk(3)).toBe(false);
    chain.played(true);
    expect(chain.count()).toBe(3);
    expect(chain.shouldAsk(3)).toBe(true);
    expect(chain.shouldAsk(0)).toBe(false);
    chain.interacted();
    expect(chain.shouldAsk(3)).toBe(false);
    chain.played(true);
    chain.played(true);
    chain.played(false);
    expect(chain.count()).toBe(0);
  });
});

describe('countdownSeconds', () => {
  it('accepts the offered choices and falls back to the default', () => {
    expect(countdownSeconds(0)).toBe(0);
    expect(countdownSeconds(15)).toBe(15);
    expect(countdownSeconds(7)).toBe(DEFAULT_COUNTDOWN);
    expect(countdownSeconds('10')).toBe(DEFAULT_COUNTDOWN);
    expect(countdownSeconds(undefined)).toBe(DEFAULT_COUNTDOWN);
  });
});

describe('nextSource', () => {
  const tried = new Set<string>();
  const current = source('now', 'A');

  it('never switches to an uncached source by itself', () => {
    expect(nextSource([current, { ...source('u', 'A'), autoplay: 'uncached' }], current, tried)).toBeUndefined();
    expect(nextSource([current, { ...source('u', 'A'), autoplay: 'uncached' }, source('b', 'B')], current, tried)?.id).toBe('b');
  });

  it('prefers a source within the autoplay limits, then any that may autoplay', () => {
    const over = { ...source('over', 'A'), autoplay: 'outside-limits' as const };
    expect(nextSource([current, over, source('fits', 'B')], current, tried)?.id).toBe('fits');
    expect(nextSource([current, over], current, tried)?.id).toBe('over');
  });
});

describe('airedForAutoplay', () => {
  const NOW = Date.parse('2026-10-05T12:00:00Z');

  it('starts an episode by itself only once its air date has passed', () => {
    expect(airedForAutoplay({ released: '2026-10-01T00:00:00.000Z' }, NOW)).toBe(true);
    expect(airedForAutoplay({ released: '2026-10-05' }, NOW)).toBe(true);
    expect(airedForAutoplay({ released: '2026-10-12T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('offers it instead when the date is missing, malformed or the episode is unaired', () => {
    expect(airedForAutoplay({}, NOW)).toBe(false);
    expect(airedForAutoplay({ released: '' }, NOW)).toBe(false);
    expect(airedForAutoplay({ released: 'soon' }, NOW)).toBe(false);
    expect(airedForAutoplay({ released: '2026' }, NOW)).toBe(false);
    expect(airedForAutoplay({ released: '2026-13-45' }, NOW)).toBe(false);
    expect(airedForAutoplay({ released: '2026-10-01T00:00:00Z', airs: 'Airs Oct 12' }, NOW)).toBe(false);
  });

  it('goes by the exact air time when it’s known, rather than the day', () => {
    // Out today, but not until 21:00 UTC.
    expect(airedForAutoplay({ released: '2026-10-05' }, NOW, Date.parse('2026-10-05T21:00:00Z'))).toBe(false);
    expect(airedForAutoplay({ released: '2026-10-05', airs: 'Airs Oct 5' }, NOW, Date.parse('2026-10-05T02:00:00Z'))).toBe(true);
  });

  it("starts an episode from the person's own server without an air date: its file is there", () => {
    expect(airedForAutoplay({ id: 'jellyfin:0123abcd:0123456789abcdef0123456789abcdef' }, NOW)).toBe(true);
    expect(airedForAutoplay({ id: 'plex:0123abcd:4567' }, NOW)).toBe(true);
    expect(airedForAutoplay({ id: 'tt0944947:1:2' }, NOW)).toBe(false);
  });
});

describe('countdownWaits', () => {
  it('waits while the viewer has paused or a panel is open', () => {
    expect(countdownWaits({ paused: true, ended: false, panelOpen: false })).toBe(true);
    expect(countdownWaits({ paused: false, ended: false, panelOpen: true })).toBe(true);
    expect(countdownWaits({ paused: false, ended: false, panelOpen: false })).toBe(false);
  });

  it('keeps counting once the episode has ended (mpv pauses on the last frame by itself)', () => {
    expect(countdownWaits({ paused: true, ended: true, panelOpen: false })).toBe(false);
    expect(countdownWaits({ paused: true, ended: true, panelOpen: true })).toBe(true);
  });

  it('without known credits, runs out no earlier than the episode ends: the last scene isn’t cut', () => {
    // A 22-minute sitcom: the card appears at 94 %, 79 s before the end, with 10 s to count down.
    expect(countdownWaits({ paused: false, ended: false, panelOpen: false, untilEnd: 79, remaining: 10 })).toBe(true);
    expect(countdownWaits({ paused: false, ended: false, panelOpen: false, untilEnd: 10, remaining: 10 })).toBe(false);
    // Known credits (untilEnd left out) count down from the card as before.
    expect(countdownWaits({ paused: false, ended: false, panelOpen: false, remaining: 10 })).toBe(false);
  });
});

describe('when Next Up appears without known credits', () => {
  it('reads the saved choice, falling back to 94 % for anything else', () => {
    expect(parseNextUpAt(undefined)).toEqual({ mode: 'percent', value: 94 });
    expect(parseNextUpAt({ mode: 'percent', value: 90 })).toEqual({ mode: 'percent', value: 90 });
    expect(parseNextUpAt({ mode: 'before-end', value: 3 })).toEqual({ mode: 'before-end', value: 3 });
    for (const bad of [{ mode: 'percent', value: 99 }, { mode: 'percent', value: 84 }, { mode: 'before-end', value: 0 }, { mode: 'before-end', value: 2.5 }, { mode: 'later', value: 3 }, 'percent', null]) expect(parseNextUpAt(bad)).toEqual({ mode: 'percent', value: 94 });
  });

  it('keeps the old 94 % by default', () => {
    expect(reachedNextUp(939, 1000, parseNextUpAt(undefined))).toBe(false);
    expect(reachedNextUp(940, 1000, parseNextUpAt(undefined))).toBe(true);
  });

  it('counts minutes back from the end, never before the halfway point', () => {
    const twoMinutes = { mode: 'before-end', value: 2 } as const;
    expect(reachedNextUp(2579, 2700, twoMinutes)).toBe(false);
    expect(reachedNextUp(2580, 2700, twoMinutes)).toBe(true);
    // A 3-minute clip: halfway, not 2 minutes before its end (1 minute in).
    expect(reachedNextUp(60, 180, twoMinutes)).toBe(false);
    expect(reachedNextUp(90, 180, twoMinutes)).toBe(true);
    expect(reachedNextUp(10, 0, twoMinutes)).toBe(false);
  });

  it('has two styles, the card by default', () => {
    expect(parseNextUpStyle('panel')).toBe('panel');
    expect(parseNextUpStyle('drawer')).toBe('card');
  });
});

describe('Next pressed while the Next Up card is up', () => {
  // Credits that start at 89 % (an anime's ending), under the 90 % watched threshold.
  const duration = 1440;
  const inCredits = 1282;

  it("counts as the card's own Play: the episode left was watched", () => {
    // Android's player screen shows the card as a button that sends Next (MediaTrackNext), as a remote's Next does.
    expect(leftAt(inCredits, duration, handsOff(false, true))).toBe(duration);
    expect(leftAt(inCredits, duration, handsOff(true, false))).toBe(duration);
  });

  it('saves where it really got to when Next is pressed part-way, with no card up', () => {
    expect(leftAt(600, duration, handsOff(false, false))).toBe(600);
  });
});
