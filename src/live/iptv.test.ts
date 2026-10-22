import { describe, expect, it } from 'vitest';
import { accountState, canReplay, programmeQuery, replayAddress, type TvAccount, type TvChannel } from './iptv';

const channel: TvChannel = { source: 's1', key: 'k1', name: 'News', logo: null, group: null, favourite: false, rank: null, listed: true, archive: 2 };
const now = 1_000_000;
const show = (start: number, stop: number) => ({ title: 'x', start, stop, description: null });

describe('catch-up', () => {
  it('replays finished programmes inside the archive only', () => {
    expect(canReplay(channel, show(now - 7200, now - 3600), now)).toBe(true);
    expect(canReplay(channel, show(now - 600, now + 600), now)).toBe(false);
    expect(canReplay(channel, show(now - 3 * 86_400, now - 3 * 86_400 + 3600), now)).toBe(false);
    expect(canReplay({ ...channel, archive: 0 }, show(now - 7200, now - 3600), now)).toBe(false);
  });

  it('offers no replay of a programme longer than Rust replays (12 hours)', () => {
    expect(canReplay(channel, show(now - 13 * 3600 - 1, now - 3600), now)).toBe(false);
    expect(canReplay(channel, show(now - 13 * 3600, now - 3600), now)).toBe(true);
  });

  it('asks Rust for the programme by time', () => {
    expect(replayAddress(channel, show(1000, 4600))).toMatch(/^orbit-tv:\/\/s1\/k1\?start=1000&end=4600&tz=-?\d+$/);
  });
});

describe('account', () => {
  const account: TvAccount = { status: 'active', expires: null, maxConnections: 1, activeConnections: 0, trial: false, checkedAt: 0 };
  const nowMs = 1_000_000_000;

  it('counts the days left, any part of a day as one', () => {
    expect(accountState({ ...account, expires: nowMs / 1000 + 12 * 86_400 }, nowMs)).toEqual({ kind: 'days', days: 12 });
    expect(accountState({ ...account, expires: nowMs / 1000 + 60 }, nowMs)).toEqual({ kind: 'days', days: 1 });
    expect(accountState(account, nowMs)).toEqual({ kind: 'unlimited' });
  });

  it('says when it has ended or is off', () => {
    expect(accountState({ ...account, expires: nowMs / 1000 - 1 }, nowMs)).toEqual({ kind: 'expired' });
    expect(accountState({ ...account, status: 'expired', expires: nowMs / 1000 + 86_400 }, nowMs)).toEqual({ kind: 'expired' });
    expect(accountState({ ...account, status: 'banned' }, nowMs)).toEqual({ kind: 'inactive', status: 'banned' });
    expect(accountState({ ...account, status: null, expires: nowMs / 1000 + 86_400 }, nowMs)).toEqual({ kind: 'days', days: 1 });
  });
});

describe('searching for a programme', () => {
  it('drops what guides add to titles', () => {
    expect(programmeQuery('Good Day Alabama 8a ᴺᵉʷ')).toBe('Good Day Alabama 8a');
    expect(programmeQuery('NFL Football ᴸᶦᵛᵉ')).toBe('NFL Football');
    expect(programmeQuery('New: The Great British Bake Off [HD] [S]')).toBe('The Great British Bake Off');
    expect(programmeQuery('Doctor Who - S02E05 - Rise of the Cybermen')).toBe('Doctor Who');
    expect(programmeQuery('Friends (S5 E14)')).toBe('Friends');
    expect(programmeQuery('The Simpsons')).toBe('The Simpsons');
    expect(programmeQuery('  ')).toBe('');
  });

  it('keeps the letters some languages write with modifier marks (the okina, the Ukrainian apostrophe)', () => {
    expect(programmeQuery('Hawaiʻi Five-0')).toBe('Hawaiʻi Five-0');
    expect(programmeQuery('Сімʼя ᴺᵉʷ')).toBe('Сімʼя');
  });
});
