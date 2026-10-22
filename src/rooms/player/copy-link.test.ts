import { describe, expect, it, vi } from 'vitest';
import { copyableLink, createCopyLink, type CopyLinkHost } from './copy-link';

const DEBRID = 'https://addon.example/resolve/realdebrid/SECRETKEY/abc/1/movie.mkv';

function host(warned = false) {
  const state = { warned };
  const h = {
    warned: vi.fn(async () => state.warned),
    setWarned: vi.fn(async () => {
      state.warned = true;
    }),
    ask: vi.fn(),
    write: vi.fn<(text: string) => Promise<void>>(async () => {}),
    say: vi.fn(),
  } satisfies CopyLinkHost;
  return h;
}

describe('copyableLink', () => {
  it('offers web links (which may hold a key) and magnets (which don’t)', () => {
    expect(copyableLink(DEBRID)).toEqual({ link: DEBRID, sensitive: true });
    expect(copyableLink('http://192.168.1.5:8080/v.mp4')?.sensitive).toBe(true);
    expect(copyableLink('magnet:?xt=urn:btih:abc&so=2')).toEqual({ link: 'magnet:?xt=urn:btih:abc&so=2', sensitive: false });
  });

  it('counts a magnet naming trackers as sensitive (a private tracker’s address holds a passkey)', () => {
    expect(copyableLink('magnet:?xt=urn:btih:abc&tr=https%3A%2F%2Ftracker.example%2Fabc123%2Fannounce')?.sensitive).toBe(true);
    expect(copyableLink('magnet:?tr=udp%3A%2F%2Ft.example%3A80&xt=urn:btih:abc')?.sensitive).toBe(true);
    expect(copyableLink('magnet:?xt=urn:btih:abc&tr.1=udp%3A%2F%2Ft.example')?.sensitive).toBe(true);
    expect(copyableLink('magnet:?xt=urn:btih:abc&dn=str%26tr=x')?.sensitive).toBe(false);
  });

  it('never offers Orbit’s own locators, which stand for addresses kept in Rust', () => {
    for (const url of ['orbit-tv://src/ch', 'orbit-debrid://torbox/1/2', 'orbit-jellyfin://item/v', 'orbit-plex://1/2', 'orbit-download://7', 'orbit-local://k', 'orbit-trailer://abc', 'file:///C:/x.mkv', 'not a url']) {
      expect(copyableLink(url), url).toBeNull();
    }
  });
});

describe('copying', () => {
  it('asks first, copying nothing until the warning is accepted', async () => {
    const h = host();
    const copy = createCopyLink(h);
    expect(await copy.request(DEBRID)).toBe('asked');
    expect(h.ask).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.setWarned).not.toHaveBeenCalled();
  });

  it('copies once accepted, says so, and doesn’t ask again', async () => {
    const h = host();
    const copy = createCopyLink(h);
    expect(await copy.confirmed(DEBRID)).toBe('copied');
    expect(h.write).toHaveBeenCalledWith(DEBRID);
    expect(h.say).toHaveBeenCalledWith('copied');
    expect(await copy.request(DEBRID)).toBe('copied');
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it('copies a magnet without trackers without the warning (it carries no account key)', async () => {
    const h = host();
    expect(await createCopyLink(h).request('magnet:?xt=urn:btih:abc')).toBe('copied');
    expect(h.ask).not.toHaveBeenCalled();
  });

  it('says when the clipboard refuses, without passing the error (or the link) on', async () => {
    const h = host(true);
    h.write.mockRejectedValueOnce(new Error(`denied: ${DEBRID}`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createCopyLink(h).request(DEBRID)).toBe('failed');
    expect(h.say).toHaveBeenCalledWith('failed');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('offers nothing for a locator', async () => {
    const h = host(true);
    expect(await createCopyLink(h).request('orbit-tv://src/ch')).toBe('unavailable');
    expect(h.write).not.toHaveBeenCalled();
  });
});
