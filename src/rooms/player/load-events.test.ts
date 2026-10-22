import { describe, expect, it } from 'vitest';
import { acceptsEvent } from './load-events';

describe('acceptsEvent', () => {
  it('drops every event from an earlier load, errors included', () => {
    // Surfed from load 4 to load 5: channel 4's late error must not fail over channel 5.
    for (const kind of ['error', 'loaded', 'ready', 'status', 'tracks', 'ended']) {
      expect(acceptsEvent(kind, 4, 5, true)).toBe(false);
      expect(acceptsEvent(kind, 4, 5, false)).toBe(false);
    }
    expect(acceptsEvent('status', undefined, 5, false)).toBe(false);
  });

  it('before the file loads, takes only its errors, lists and the load itself', () => {
    expect(acceptsEvent('loaded', 5, 5, true)).toBe(true);
    expect(acceptsEvent('error', 5, 5, true)).toBe(true);
    expect(acceptsEvent('tracks', 5, 5, true)).toBe(true);
    expect(acceptsEvent('chapters', 5, 5, true)).toBe(true);
    // Android's player screen closed while still loading: the page leaves its player too.
    expect(acceptsEvent('closed', 5, 5, true)).toBe(true);
    expect(acceptsEvent('status', 5, 5, true)).toBe(false);
    expect(acceptsEvent('ready', 5, 5, true)).toBe(false);
    expect(acceptsEvent('ended', 5, 5, true)).toBe(false);
  });

  it('takes everything for the current load once it has loaded', () => {
    for (const kind of ['status', 'ready', 'ended', 'error']) expect(acceptsEvent(kind, 5, 5, false)).toBe(true);
  });
});
