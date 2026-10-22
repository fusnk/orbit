import { describe, expect, it, vi } from 'vitest';

const manifest = { id: 'org.a', version: '1.0.0', name: 'A', resources: ['stream'], types: ['movie'], catalogs: [] };
const invoke = vi.fn(async (_command: string, args: { url: string; fromLink?: boolean }) => {
  if (args.fromLink && args.url.includes('192.168.')) throw { kind: 'blocked', reason: 'local' };
  return JSON.stringify(manifest);
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string, args: { url: string; fromLink?: boolean }) => invoke(command, args) }));

import { fetchLinkedManifest } from './registry';

describe("an install link's manifest", () => {
  it('is fetched for the preview from the internet, marked as unconfirmed', async () => {
    expect((await fetchLinkedManifest('https://a.example/manifest.json'))?.id).toBe('org.a');
    expect(invoke).toHaveBeenLastCalledWith('addon_fetch_manifest', { url: 'https://a.example/manifest.json', fromLink: true });
  });

  it('waits for the person when it leads to this machine or the home network', async () => {
    expect(await fetchLinkedManifest('https://192.168.1.5/manifest.json')).toBeNull();
  });

  it('still fails as before for anything else', async () => {
    invoke.mockRejectedValueOnce({ kind: 'timeout' });
    await expect(fetchLinkedManifest('https://a.example/manifest.json')).rejects.toMatchObject({ error: { kind: 'timeout' } });
  });
});
