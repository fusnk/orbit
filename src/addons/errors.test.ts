import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({ settings: { get: vi.fn(), set: vi.fn() } }));

const { setLanguage } = await import('../i18n');
const { describeAddonError, describeManifestError } = await import('./errors');
await setLanguage('en').catch(() => {});

describe('addon errors in words', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says why an address was refused in Orbit’s words, from Rust’s code', () => {
    expect(describeAddonError({ kind: 'invalid-url', reason: 'manifest-path' })).toBe('That isn’t an addon’s install link. Install links end in /manifest.json.');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'not-url' })).toContain('isn’t a web address');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'credentials' })).toContain('user name or password');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'query' })).toContain('“?”');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'resource-path' })).toBe('Orbit couldn’t make a request this addon can answer. Try again, or reinstall the addon.');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'token' })).toBe('The saved key has characters that can’t be sent. Paste it again.');
    // Not a code: the general sentence, never the text itself.
    expect(describeAddonError({ kind: 'invalid-url', reason: 'constructor' })).toBe('That address can’t be used for an addon.');
    expect(describeAddonError({ kind: 'invalid-url', reason: 'not a valid URL' })).toBe('That address can’t be used for an addon.');
  });

  it('keeps schema paths and parser messages out of what the person reads', () => {
    const text = describeAddonError({ kind: 'invalid-response', issues: ['id: Invalid key: Expected "id" but received undefined'] });
    expect(text).toBe('The addon sent data Orbit couldn’t read.');
  });

  it('says a manifest that couldn’t be loaded the way an install needs', () => {
    expect(describeManifestError({ kind: 'http', status: 404 })).toContain('no addon at that address');
    expect(describeManifestError({ kind: 'http', status: 500 })).toBe(describeAddonError({ kind: 'http', status: 500 }));
    expect(describeManifestError({ kind: 'invalid-response', issues: ['not valid JSON'] })).toContain('didn’t answer with an addon');
    vi.stubGlobal('navigator', { onLine: false });
    // Offline, nothing loads it again by itself: the person tries again once connected.
    expect(describeManifestError({ kind: 'network', message: 'dns error' })).toBe('You’re offline. Connect to the internet, then try again.');
  });
});
