import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import { afterEnd, creditsStarted, endPicks, endScreenDue, isFilm, leavesFinished, nextInFranchise, parseFilmEnd, playsFromStart } from './end-screen-rules';
import { leftAt } from './next-up';

const film = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [] });
const due = { film: true, upNext: false, started: true, ended: false, timePos: 100, segments: [] };

describe('end screen', () => {
  it('is on unless the setting says to just stop', () => {
    expect(parseFilmEnd(undefined)).toBe('next');
    expect(parseFilmEnd('next')).toBe('next');
    expect(parseFilmEnd('stop')).toBe('stop');
    expect(parseFilmEnd(true)).toBe('next');
  });

  it('is for films only: not episodes, channels, catch-up, trailers or files from this PC', () => {
    const title = film('tt1');
    expect(isFilm({ title })).toBe(true);
    expect(isFilm({ title: { type: 'series' } })).toBe(false);
    expect(isFilm({ title, episode: {} })).toBe(false);
    expect(isFilm({ title, live: true })).toBe(false);
    expect(isFilm({ title, replay: true })).toBe(false);
    expect(isFilm({ title, trailer: true })).toBe(false);
    expect(isFilm({ title, local: true })).toBe(false);
  });

  it('shows once the credits start, or at the end without credit times, with nothing up next', () => {
    const credits = [{ kind: 'credits' as const, start: 5000, end: 5400 }];
    expect(endScreenDue(due)).toBe(false);
    expect(endScreenDue({ ...due, ended: true })).toBe(true);
    expect(endScreenDue({ ...due, segments: credits, timePos: 4999 })).toBe(false);
    expect(endScreenDue({ ...due, segments: credits, timePos: 5000 })).toBe(true);
    // An intro's times don't count as the credits.
    expect(endScreenDue({ ...due, segments: [{ kind: 'intro' as const, start: 10, end: 90 }], timePos: 100 })).toBe(false);
    expect(endScreenDue({ ...due, ended: true, upNext: true })).toBe(false);
    expect(endScreenDue({ ...due, ended: true, film: false })).toBe(false);
    expect(endScreenDue({ ...due, ended: true, started: false })).toBe(false);
  });

  it('suggests unseen titles in TMDB’s order, never the film itself or one twice', () => {
    const recs = ['tt1', 'tt2', 'tt3', 'tt2', 'tt4', 'tt5', 'tt6', 'tt7', 'tt8'].map(film);
    const seen = (title: Title) => title.id === 'tt3' || title.id === 'tt5';
    expect(endPicks(recs, 'tt1', seen).map((t) => t.id)).toEqual(['tt2', 'tt4', 'tt6', 'tt7', 'tt8']);
    expect(endPicks(recs, 'tt9', () => false, 3).map((t) => t.id)).toEqual(['tt1', 'tt2', 'tt3']);
    expect(endPicks([], 'tt1', () => false)).toEqual([]);
  });
});

describe('the next film in a franchise', () => {
  const part = (id: string, released?: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...(released ? { released } : {}) });
  const parts = [part('tt1', '2001-12-19'), part('tt2', '2002-12-18'), part('tt3', '2003-12-17'), part('tt4', '2099-05-01'), part('tt5')];
  const now = Date.parse('2026-10-14');
  const none = () => false;

  it('is the next part that’s out, skipping ones already watched', () => {
    expect(nextInFranchise(parts, 'tt1', none, now)?.id).toBe('tt2');
    expect(nextInFranchise(parts, 'tt1', (t) => t.id === 'tt2', now)?.id).toBe('tt3');
  });

  it('isn’t offered before it’s released, without a date, or for the last part', () => {
    expect(nextInFranchise(parts, 'tt3', none, now)).toBeUndefined();
    expect(nextInFranchise(parts, 'tt5', none, now)).toBeUndefined();
    expect(nextInFranchise(parts, 'tt9', none, now)).toBeUndefined();
    expect(nextInFranchise(parts, 'tt3', none, Date.parse('2099-05-02'))?.id).toBe('tt4');
  });

  it('comes first among the picks, once', () => {
    const recommended = [part('tt7'), part('tt2'), part('tt8')];
    expect(endPicks(recommended, 'tt1', none, 5, part('tt2')).map((t) => t.id)).toEqual(['tt2', 'tt7', 'tt8']);
    expect(endPicks(recommended, 'tt1', none, 5).map((t) => t.id)).toEqual(['tt7', 'tt2', 'tt8']);
  });
});

describe('Play on the last frame', () => {
  it('starts over from the end, or within half a second of it', () => {
    expect(playsFromStart({ eof: true, timePos: 100, duration: 7200 })).toBe(true);
    expect(playsFromStart({ eof: false, timePos: 7199.6, duration: 7200 })).toBe(true);
  });

  it('just plays anywhere else, or without a known length', () => {
    expect(playsFromStart({ eof: false, timePos: 7199, duration: 7200 })).toBe(false);
    expect(playsFromStart({ eof: false, timePos: 0, duration: null })).toBe(false);
    expect(playsFromStart({ eof: false, timePos: null, duration: 7200 })).toBe(false);
  });
});

describe('leaving a film from its end screen', () => {
  it('counts as finished, as Next Up does, however the screen is left', () => {
    // The credits start at 6900 of 7200: Play on a pick, Details or Back while the screen is up.
    expect(leftAt(6900, 7200, leavesFinished(false, true))).toBe(7200);
    // Next Up's hand-off, as before.
    expect(leftAt(6900, 7200, leavesFinished(true, false))).toBe(7200);
    // Leaving part-way, with no screen up, keeps the real place.
    expect(leftAt(3000, 7200, leavesFinished(false, false))).toBe(3000);
  });
});

describe('leaving in the credits', () => {
  // An anime episode whose ending starts at 89 %, under the 90 % watched threshold.
  const segments = [{ kind: 'credits' as const, start: 1282, end: 1372 }, { kind: 'preview' as const, start: 1372, end: 1440 }];

  it('counts as finished with no card or end screen up (autoplay off, "let the credits play out", Back from the takeover)', () => {
    expect(leftAt(1300, 1440, leavesFinished(false, false, creditsStarted(segments, 1300)))).toBe(1440);
    // The "next time" preview after them too, as Next Up counts it.
    expect(leftAt(1400, 1440, leavesFinished(false, false, creditsStarted(segments, 1400)))).toBe(1440);
  });

  it('keeps the real place before the credits, or when their time is unknown', () => {
    expect(leftAt(1200, 1440, leavesFinished(false, false, creditsStarted(segments, 1200)))).toBe(1200);
    expect(leftAt(1300, 1440, leavesFinished(false, false, creditsStarted([], 1300)))).toBe(1300);
    expect(creditsStarted(segments, null)).toBe(false);
    expect(creditsStarted([{ kind: 'intro', start: 0, end: 90 }], 60)).toBe(false);
  });
});

describe('going back after a film ended', () => {
  const ended = { ended: true, dismissed: 'end' as const, paused: false, duration: 7200, inCredits: false };
  it('playing again before the credits is no longer the end: the screen comes back at the credits', () => {
    expect(afterEnd({ ...ended, timePos: 3000 })).toEqual({ ended: false, dismissed: null });
  });
  it('playing again inside the credits waits for the end, as "Watch credits" did', () => {
    expect(afterEnd({ ...ended, timePos: 6900, inCredits: true })).toEqual({ ended: false, dismissed: 'credits' });
  });
  it('still at the end, or paused after seeking back, nothing changes yet', () => {
    expect(afterEnd({ ...ended, timePos: 7199.8 })).toEqual({ ended: true, dismissed: 'end' });
    expect(afterEnd({ ...ended, timePos: 3000, paused: true })).toEqual({ ended: true, dismissed: 'end' });
    expect(afterEnd({ ...ended, ended: false, dismissed: null, timePos: 3000 })).toEqual({ ended: false, dismissed: null });
  });
});
