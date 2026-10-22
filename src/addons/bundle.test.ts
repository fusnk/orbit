import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { BundleError, MAX_BUNDLE_ADDONS, MAX_BUNDLE_CHARS, bundleManifest, parseBundle, plainInstallUrl, publicHost } from './bundle';

const bundle = (addons: unknown[], format = 1) => JSON.stringify({ orbitAddons: format, addons });
const reason = (text: string) => {
  try {
    parseBundle(text);
  } catch (err) {
    return err instanceof BundleError ? err.reason : 'other';
  }
  return 'ok';
};

describe('parseBundle', () => {
  it('reads install and setup entries in order', () => {
    const { entries, skipped } = parseBundle(
      bundle([
        { name: 'Subs', id: 'org.subs', version: '1.0.0', url: 'https://subs.example/manifest.json' },
        { name: 'Debrid', id: 'org.debrid', version: '2.1.0', host: 'Debrid.Example', needsSetup: true },
      ]),
    );
    expect(skipped).toBe(0);
    expect(entries).toEqual([
      { kind: 'install', name: 'Subs', id: 'org.subs', version: '1.0.0', url: 'https://subs.example/manifest.json' },
      { kind: 'setup', name: 'Debrid', id: 'org.debrid', version: '2.1.0', host: 'debrid.example' },
    ]);
  });

  it('never accepts an install URL that could carry settings or reach this machine', () => {
    const urls = [
      'https://a.example/eyJrZXkiOiJzZWNyZXQifQ/manifest.json',
      'https://a.example/manifest.json?token=secret',
      'https://user:pass@a.example/manifest.json',
      'https://a.example/manifest.json#x',
      'http://a.example/manifest.json',
      'http://127.0.0.1:7000/manifest.json',
      'https://127.0.0.1/manifest.json',
      'https://192.168.1.2/manifest.json',
      'https://[::1]/manifest.json',
      'https://localhost/manifest.json',
      'https://printer.localhost/manifest.json',
      'stremio://a.example/manifest.json',
      'javascript:alert(1)',
    ];
    const { entries, skipped } = parseBundle(bundle([{ name: 'Ok', id: 'ok', url: 'https://ok.example/manifest.json' }, ...urls.map((url, i) => ({ name: 'X', id: `x${i}`, url }))]));
    expect(entries.map((e) => e.id)).toEqual(['ok']);
    expect(skipped).toBe(urls.length);
  });

  it('keeps a setup entry but drops a host that is not public', () => {
    const { entries } = parseBundle(bundle([{ name: 'Local', id: 'l', host: '127.0.0.1:7000', needsSetup: true }, { name: 'Odd', id: 'o', host: 'a.example/path?x', needsSetup: true }]));
    expect(entries).toEqual([
      { kind: 'setup', name: 'Local', id: 'l', version: undefined, host: null },
      { kind: 'setup', name: 'Odd', id: 'o', version: undefined, host: null },
    ]);
  });

  it('skips repeats and unreadable entries, and cleans up names', () => {
    const { entries, skipped } = parseBundle(
      bundle([
        { name: ' A\u0007 ', id: 'a', url: 'https://a.example/manifest.json' },
        { name: 'A again', id: 'a', url: 'https://b.example/manifest.json' },
        { name: '', id: 'empty-name', url: 'https://c.example/manifest.json' },
        'not an object',
        { name: 'No URL', id: 'n' },
      ]),
    );
    expect(entries.map((e) => e.name)).toEqual(['A']);
    expect(skipped).toBe(4);
  });

  it('rejects what is not a bundle', () => {
    expect(reason('not json')).toBe('not-a-bundle');
    expect(reason(JSON.stringify({ addons: [] }))).toBe('not-a-bundle');
    expect(reason(JSON.stringify([1, 2]))).toBe('not-a-bundle');
    expect(reason(bundle([], 2))).toBe('newer');
    expect(reason(bundle([]))).toBe('empty');
    expect(reason(bundle([{ name: 'X', id: 'x', url: 'https://a.example/x/manifest.json' }]))).toBe('empty');
  });

  it('caps size and count', () => {
    expect(reason(' '.repeat(MAX_BUNDLE_CHARS + 1))).toBe('too-large');
    const many = Array.from({ length: MAX_BUNDLE_ADDONS + 1 }, (_, i) => ({ name: 'X', id: `x${i}`, url: `https://a${i}.example/manifest.json` }));
    expect(reason(bundle(many))).toBe('too-large');
    expect(parseBundle(bundle(many.slice(0, MAX_BUNDLE_ADDONS))).entries).toHaveLength(MAX_BUNDLE_ADDONS);
  });
});

describe('hosts and URLs', () => {
  it('accepts only public names', () => {
    expect(publicHost('a.example')).toBe(true);
    expect(publicHost('a.example:8443')).toBe(true);
    for (const host of ['localhost', 'x.localhost', '10.0.0.1', '[fd00::1]', 'intranet', 'a.example/x', 'u@a.example', '']) expect(publicHost(host), host).toBe(false);
  });

  it('rebuilds a plain install URL', () => {
    expect(plainInstallUrl('https://A.example/manifest.json')).toBe('https://a.example/manifest.json');
    expect(plainInstallUrl('https://a.example/cfg/manifest.json')).toBeNull();
  });
});

describe('bundleManifest', () => {
  it('fetches as an unconfirmed link, so a name leading into the LAN is never contacted', async () => {
    // A public-looking name (`192-168-1-1.nip.io`) passes `publicHost`; only Rust's lookup can tell where it leads.
    invoke.mockReset().mockRejectedValue({ kind: 'blocked', reason: 'local' });
    expect(await bundleManifest('https://192-168-1-1.nip.io/manifest.json')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('addon_fetch_manifest', { url: 'https://192-168-1-1.nip.io/manifest.json', fromLink: true });
  });
});
