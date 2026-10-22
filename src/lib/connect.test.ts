import { describe, expect, it } from 'vitest';
import { clockTime, handoffStarted, OFF, pairable, parseConnectStatus, parseIncomingPlay, parseRemotePlayback, playMessage, playTargets, stepVolume } from './connect';

const id = (c: string) => c.repeat(32);
const device = (c: string, paired: boolean, online: boolean) => ({ id: id(c), name: `Device ${c}`, kind: 'tv' as const, paired, online });
const status = (running: boolean, devices: object[]) => ({ running, name: 'PC', kind: 'pc', expiresIn: null, locked: false, devices, maxDevices: 8 });

describe('Orbit Connect status', () => {
  it('reads the status and picks devices to play on', () => {
    const read = parseConnectStatus(status(true, [device('a', true, true), device('b', true, false), device('c', false, true)]));
    expect(playTargets(read).map((d) => d.id)).toEqual([id('a')]);
    expect(pairable(read).map((d) => d.id)).toEqual([id('c')]);
  });

  it('never plays on a device that has to pair again, and reads the number to compare', () => {
    const read = parseConnectStatus({
      ...status(true, [{ ...device('a', true, true), repair: true }]),
      prompt: { id: id('c'), name: 'TV', kind: 'tv', sas: '042137', outgoing: true, waiting: false },
    });
    expect(playTargets(read)).toEqual([]);
    expect(read.prompt?.sas).toBe('042137');
    expect(parseConnectStatus({ ...status(true, []), prompt: { id: id('c'), name: 'TV', kind: 'tv', sas: '42', outgoing: true, waiting: false } })).toEqual(OFF);
  });

  it('offers nothing while off, or for an answer that is not a status', () => {
    expect(playTargets(parseConnectStatus(status(false, [device('a', true, true)])))).toEqual([]);
    expect(parseConnectStatus(null)).toEqual(OFF);
    expect(parseConnectStatus(status(true, [{ ...device('a', true, true), id: 'not-an-id' }]))).toEqual(OFF);
  });

  it('reads names of 40 characters with emoji, as Rust caps them, not 40 UTF-16 units', () => {
    const name = '📺'.repeat(40);
    const read = parseConnectStatus(status(true, [{ ...device('a', true, true), name }]));
    expect(read.running).toBe(true);
    expect(read.devices[0]?.name).toBe(name);
    expect(parseConnectStatus(status(true, [{ ...device('a', true, true), name: '📺'.repeat(41) }]))).toEqual(OFF);
    const play = { type: 'movie', id: 'tt1', season: null, episode: null, position: null, audio: null, subtitle: null, handoff: false };
    expect(parseIncomingPlay({ from: name, play })?.from).toBe(name);
  });
});

describe('Orbit Connect play messages', () => {
  it('names a title, never where it streams from', () => {
    expect(playMessage({ type: 'movie', id: 'tt0111161' }, undefined)).toEqual({ type: 'movie', id: 'tt0111161', season: null, episode: null, position: null, audio: null, subtitle: null, handoff: false });
    const handoff = playMessage({ type: 'series', id: 'tt0944947' }, { season: 2, number: 5 }, { position: 1234.8, audio: 'en', subtitle: 'pt-BR' });
    expect(handoff).toEqual({ type: 'series', id: 'tt0944947', season: 2, episode: 5, position: 1234, audio: 'en', subtitle: 'pt-BR', handoff: true });
    expect(Object.keys(handoff!)).not.toContain('url');
  });

  it('refuses what cannot travel', () => {
    expect(playMessage({ type: 'channel', id: 'x' }, undefined)).toBeNull();
    expect(playMessage({ type: 'movie', id: 'https://example.com/a.mkv' }, undefined)).toBeNull();
    expect(playMessage({ type: 'movie', id: 'tt1' }, undefined, { position: Number.NaN, audio: null, subtitle: null })?.position).toBeNull();
  });

  it('reads a title another device sends, and nothing else', () => {
    const play = { type: 'movie', id: 'tt1', season: null, episode: null, position: 30, audio: null, subtitle: null, handoff: true };
    expect(parseIncomingPlay({ from: 'Living room', play })).toEqual({ from: 'Living room', play });
    expect(parseIncomingPlay({ from: 'x', play: { ...play, id: 'javascript:alert(1)' } })).toBeNull();
    expect(parseIncomingPlay({ from: 'x', play: { ...play, position: -1 } })).toBeNull();
    expect(parseIncomingPlay({ from: 'x', play: { ...play, audio: 'english please' } })).toBeNull();
    expect(parseIncomingPlay(null)).toBeNull();
  });
});

describe('Orbit Connect remote control', () => {
  it('reads another device’s playback', () => {
    const playing = { title: 'Film', detail: null, live: false, canNext: false, maxVolume: 100, playback: { position: 61, duration: 3600, paused: true, buffering: false, volume: 80, muted: false }, audio: [], subtitles: [] };
    expect(parseRemotePlayback({ playing })).toEqual(playing);
    expect(parseRemotePlayback({ playing: null })).toBeNull();
    expect(parseRemotePlayback('nope')).toBeUndefined();
  });

  it('formats time and steps volume within limits', () => {
    expect(clockTime(61)).toBe('1:01');
    expect(clockTime(3661)).toBe('1:01:01');
    expect(clockTime(null)).toBe('–:––');
    expect(stepVolume(98, 5, 100)).toBe(100);
    expect(stepVolume(2, -5, 100)).toBe(0);
    expect(stepVolume(null, 5, 150)).toBe(105);
  });
});

describe('a handoff', () => {
  const at = (title: string, position: number | null, detail: string | null = null) => ({
    title,
    detail,
    live: false,
    canNext: false,
    maxVolume: 100,
    playback: { position, duration: 3600, paused: false, buffering: false, volume: 80, muted: false },
    audio: [],
    subtitles: [],
  });

  it('has started once the other device plays from the moment it was handed', () => {
    expect(handoffStarted(null, at('Film', 1205), 1200)).toBe(true);
    expect(handoffStarted(at('Other', 50), at('Film', 1201), 1200)).toBe(true);
  });

  it('has not while the other device plays nothing, or only what it already played', () => {
    // Accepted, but still finding sources (or it couldn't find the title).
    expect(handoffStarted(null, null, 1200)).toBe(false);
    expect(handoffStarted(at('Other', 50), at('Other', 51), 1200)).toBe(false);
    expect(handoffStarted(null, at('Film', null), 1200)).toBe(false);
    // Something else, far from the moment handed over.
    expect(handoffStarted(null, at('Film', 10), 1200)).toBe(false);
  });

  it('from the start: anything new playing there', () => {
    expect(handoffStarted(null, at('Film', 3), null)).toBe(true);
    expect(handoffStarted(at('Show', 900, 'S1 E1'), at('Show', 2, 'S1 E2'), null)).toBe(true);
    expect(handoffStarted(at('Show', 900, 'S1 E1'), at('Show', 901, 'S1 E1'), null)).toBe(false);
  });
});
