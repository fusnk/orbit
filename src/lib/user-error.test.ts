import { describe, expect, it } from 'vitest';
import { classifyError, errorCode, playbackFailure, safeSentence } from './user-error';

const online = { online: true };

describe('classifyError', () => {
  it('reads addon errors by kind and status', () => {
    expect(classifyError({ kind: 'timeout' }, online)).toEqual({ cause: 'timeout' });
    expect(classifyError({ kind: 'network', message: 'dns error' }, online)).toEqual({ cause: 'unreachable' });
    expect(classifyError({ kind: 'invalid-response', issues: [] }, online)).toEqual({ cause: 'invalid-data' });
    expect(classifyError({ kind: 'too-large', limitBytes: 1 }, online)).toEqual({ cause: 'invalid-data' });
    expect(classifyError({ kind: 'http', status: 503 }, online)).toEqual({ cause: 'server' });
    expect(classifyError({ kind: 'http', status: 429 }, online)).toEqual({ cause: 'busy' });
    expect(classifyError({ kind: 'http', status: 404 }, online)).toEqual({ cause: 'not-found' });
  });

  it('treats an addon refusing access as a sign-in to renew', () => {
    expect(classifyError({ kind: 'http', status: 401 }, online)).toEqual({ cause: 'signed-out', service: 'addon' });
    expect(classifyError({ kind: 'http', status: 403 }, { online: true, service: 'tmdb' })).toEqual({ cause: 'signed-out', service: 'tmdb' });
  });

  it('unwraps an AddonFailure-shaped error', () => {
    const failure = Object.assign(new Error('x'), { error: { kind: 'timeout' } });
    expect(classifyError(failure, online)).toEqual({ cause: 'timeout' });
  });

  it('recognises Orbit’s own Rust codes about sign-ins', () => {
    expect(classifyError('err.stremio.session-ended', online)).toEqual({ cause: 'signed-out', service: 'stremio' });
    expect(classifyError('err.stremio.sign-in-first', online)).toEqual({ cause: 'signed-out', service: 'stremio' });
    expect(classifyError('err.tmdb.signed-out', online)).toEqual({ cause: 'signed-out', service: 'tmdb' });
    expect(classifyError('err.iptv.refused', online)).toEqual({ cause: 'signed-out', service: 'iptv' });
    expect(classifyError('err.debrid.signed-out|provider=Real-Debrid', online)).toEqual({ cause: 'signed-out', service: 'debrid' });
    expect(classifyError('err.debrid.key-unreadable|provider=TorBox', online)).toEqual({ cause: 'signed-out', service: 'debrid' });
    expect(classifyError('err.jellyfin.signed-out', online)).toEqual({ cause: 'signed-out', service: 'jellyfin' });
    expect(classifyError(new Error('err.plex.signed-out'), online)).toEqual({ cause: 'signed-out', service: 'plex' });
  });

  it('reads network trouble from codes, which is just “offline” while offline', () => {
    expect(classifyError('err.tmdb.unreachable', online)).toEqual({ cause: 'unreachable' });
    expect(classifyError('err.debrid.timeout|provider=TorBox', online)).toEqual({ cause: 'timeout' });
    expect(classifyError('err.plex.server-unreachable', online)).toEqual({ cause: 'unreachable' });
    expect(classifyError('err.tmdb.busy', online)).toEqual({ cause: 'busy' });
    expect(classifyError('err.letterboxd.unreachable', { online: false })).toEqual({ cause: 'offline' });
  });

  it('needs to know the service for bare sign-in codes', () => {
    expect(classifyError('signed-out', { online: true, service: 'anilist' })).toEqual({ cause: 'signed-out', service: 'anilist' });
    expect(classifyError('denied', { online: true, service: 'anilist' })).toEqual({ cause: 'signed-out', service: 'anilist' });
    expect(classifyError('denied', online)).toEqual({ cause: 'unknown' });
  });

  it('tells a mistyped key or password from an expired sign-in', () => {
    expect(classifyError('TMDB didn’t accept that token.', online)).toEqual({ cause: 'rejected' });
    expect(classifyError('TorBox didn’t accept that API key.', online)).toEqual({ cause: 'rejected' });
    expect(classifyError('Jellyfin didn’t accept that username and password.', online)).toEqual({ cause: 'rejected' });
  });

  it('reads network trouble from text', () => {
    expect(classifyError('Couldn’t reach Letterboxd.', online)).toEqual({ cause: 'unreachable' });
    expect(classifyError(new TypeError('Failed to fetch'), online)).toEqual({ cause: 'unreachable' });
    expect(classifyError('The Jellyfin server took too long to answer.', online)).toEqual({ cause: 'timeout' });
    expect(classifyError('TorBox asked Orbit to slow down. Try again in 12 seconds.', online)).toEqual({ cause: 'busy' });
  });

  it('calls network failures "offline" while the device is offline', () => {
    const offline = { online: false };
    expect(classifyError({ kind: 'network', message: 'x' }, offline)).toEqual({ cause: 'offline' });
    expect(classifyError({ kind: 'timeout' }, offline)).toEqual({ cause: 'offline' });
    expect(classifyError('something odd', offline)).toEqual({ cause: 'offline' });
    // Not every failure is the connection's fault.
    expect(classifyError({ kind: 'invalid-response', issues: [] }, offline)).toEqual({ cause: 'invalid-data' });
    expect(classifyError('err.stremio.sign-in-first', offline)).toEqual({ cause: 'signed-out', service: 'stremio' });
  });

  it('falls back to unknown for anything else', () => {
    expect(classifyError(undefined, online)).toEqual({ cause: 'unknown' });
    expect(classifyError({ weird: true }, online)).toEqual({ cause: 'unknown' });
    expect(classifyError('Use a PNG, JPEG or WebP image.', online)).toEqual({ cause: 'unknown' });
  });
});

describe('errorCode', () => {
  it('reads a code and its parameters', () => {
    expect(errorCode('err.lists.gone')).toEqual({ name: 'lists.gone', params: {} });
    expect(errorCode('err.lists.limit|max=100')).toEqual({ name: 'lists.limit', params: { max: '100' } });
    expect(errorCode(new Error('err.plex.unreachable|server=Den = TV'))).toEqual({ name: 'plex.unreachable', params: { server: 'Den = TV' } });
    expect(errorCode('err.debrid.status|provider=TorBox|status=503')).toEqual({ name: 'debrid.status', params: { provider: 'TorBox', status: '503' } });
  });

  it('ignores anything that isn’t exactly a code', () => {
    for (const text of ['Couldn’t save the file.', 'err.', 'err.Lists', 'err.x|max', 'err.x|max=1\nmore', ' err.x', 'error.x', 'signed-out']) expect(errorCode(text)).toBeNull();
    expect(errorCode({ kind: 'timeout' })).toBeNull();
    expect(errorCode(undefined)).toBeNull();
  });

  it('caps a parameter', () => {
    expect(errorCode(`err.x|name=${'a'.repeat(500)}`)!.params.name).toHaveLength(80);
  });

  it('is a cause of its own, even offline', () => {
    expect(classifyError('err.picture.too-large', online)).toEqual({ cause: 'unknown' });
    expect(classifyError('err.picture.too-large', { online: false })).toEqual({ cause: 'unknown' });
    expect(classifyError('err.iptv.no-archive', { online: false })).toEqual({ cause: 'unknown' });
  });
});

describe('safeSentence', () => {
  it('keeps plain sentences', () => {
    expect(safeSentence('Use a PNG, JPEG or WebP image.')).toBe('Use a PNG, JPEG or WebP image.');
    expect(safeSentence(new Error('You can have up to 8 profiles.'))).toBe('You can have up to 8 profiles.');
  });

  it('drops technical or revealing text', () => {
    expect(safeSentence('error sending request for url')).toBeNull();
    expect(safeSentence('Could not open https://example.com/abc/manifest.json.')).toBeNull();
    expect(safeSentence('Saved to C:\\Users\\sam\\file.txt.')).toBeNull();
    expect(safeSentence('Key AbCdEf0123456789AbCdEf0123456789 was refused.')).toBeNull();
    expect(safeSentence('TypeError: x is undefined.')).toBeNull();
    expect(safeSentence('Cannot read properties of undefined.')).toBeNull();
    expect(safeSentence('First line.\nSecond line.')).toBeNull();
    expect(safeSentence(undefined)).toBeNull();
    expect(safeSentence({ message: 'Looks fine.' })).toBeNull();
    expect(safeSentence('x'.repeat(10) + ' '.repeat(1) + 'y'.repeat(250) + '.')).toBeNull();
  });
});

describe('playbackFailure', () => {
  it('reads mpv’s error strings', () => {
    expect(playbackFailure('loading failed', true)).toBe('loading-failed');
    expect(playbackFailure('unrecognized file format', true)).toBe('format');
    expect(playbackFailure('no audio or video data played', true)).toBe('format');
    expect(playbackFailure('video output initialization failed', true)).toBe('output');
    expect(playbackFailure('audio output initialization failed', false)).toBe('output');
    expect(playbackFailure('generic error', true)).toBe('failed');
    expect(playbackFailure(undefined, true)).toBe('failed');
  });

  it('blames the connection while offline', () => {
    expect(playbackFailure('loading failed', false)).toBe('offline');
    expect(playbackFailure('generic error', false)).toBe('offline');
  });
});
