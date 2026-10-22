import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { DEFAULT_SEEK_BAR, parseSeekBar, pruneSeekImages, seekImages, seekImageUrl, withoutImages } from './seekbar';

describe('seek bar pictures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('let go of the blob: URLs of pictures pruned away', async () => {
    // Every picture tried in Theme Studio kept its URL (and image) for the session, though its file was deleted.
    let made = 0;
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => `blob:${++made}`, revokeObjectURL: revoke });
    invoke.mockImplementation(async (cmd: string) => (cmd === 'theme_image_get' ? new ArrayBuffer(4) : undefined));
    expect(await seekImageUrl('upload-a')).toBe('blob:1');
    expect(await seekImageUrl('upload-b')).toBe('blob:2');
    await pruneSeekImages(['upload-a']);
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:2'));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(await seekImageUrl('upload-a')).toBe('blob:1');
  });
});

describe('seek bar styles', () => {
  it('read a saved style', () => {
    const bar = { ...DEFAULT_SEEK_BAR, style: 'glass', height: 8, color: '#FFF', dot: 'square' };
    expect(parseSeekBar(bar)).toEqual({ ...bar, color: '#ffffff' });
  });

  it('fall back to Orbit’s own bar for anything out of range or unknown', () => {
    for (const bad of [
      null,
      { ...DEFAULT_SEEK_BAR, height: 1 },
      { ...DEFAULT_SEEK_BAR, height: 4.5 },
      { ...DEFAULT_SEEK_BAR, dotSize: 99 },
      { ...DEFAULT_SEEK_BAR, style: 'neon' },
      { ...DEFAULT_SEEK_BAR, color: 'red' },
      { ...DEFAULT_SEEK_BAR, color: 'url(https://x)' },
      { ...DEFAULT_SEEK_BAR, barImage: 'upload-../../x' },
      { ...DEFAULT_SEEK_BAR, dotImage: 'C:/Windows/x' },
    ]) {
      expect(parseSeekBar(bad)).toEqual(DEFAULT_SEEK_BAR);
    }
  });

  it('leave pictures behind when shared', () => {
    const bar = { ...DEFAULT_SEEK_BAR, barImage: 'upload-0123456789abcdef', dot: 'image' as const, dotImage: 'upload-fedcba9876543210' };
    expect(seekImages(bar)).toEqual(['upload-0123456789abcdef', 'upload-fedcba9876543210']);
    expect(withoutImages(bar)).toEqual({ ...DEFAULT_SEEK_BAR, dot: 'circle' });
    expect(withoutImages({ ...DEFAULT_SEEK_BAR, dot: 'hidden' }).dot).toBe('hidden');
  });
});
