/**
 * Stream info → Copy stream link: puts the playing source's address on the
 * clipboard, to open it in another player or app.
 *
 * Debrid and addon links often carry the person's account key, so the first
 * copy of such a link (per profile) explains that and waits for a yes; after
 * that it copies straight away. The address is only ever handed to the
 * clipboard: never logged, shown or put in an error.
 *
 * Only addresses another app could open are offered: web links and magnets.
 * Orbit's own locators (Live TV, Jellyfin, Plex, debrid cloud, downloads,
 * files on this PC, trailers) stand for addresses or sign-ins kept in Rust,
 * which the page never has.
 */

/** Per profile (`<prefix>.<profile id>`): the warning has been read and accepted. */
export const COPY_LINK_WARNED_PREFIX = 'player.copy-link-warned';

export interface CopyableLink {
  link: string;
  /** May include an account key: a web link, or a magnet naming trackers (a private tracker's address holds a passkey). */
  sensitive: boolean;
}

/** The link to copy for a source address, or null when there's none another app could open. */
export function copyableLink(url: string): CopyableLink | null {
  if (/^magnet:\?/i.test(url)) return { link: url, sensitive: /[?&]tr(\.\d+)?=/i.test(url) };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? { link: url, sensitive: true } : null;
}

export type CopyOutcome = 'copied' | 'asked' | 'failed' | 'unavailable';

export interface CopyLinkHost {
  /** Whether this profile has accepted the warning before. */
  warned(): Promise<boolean>;
  /** Remembers that it has. */
  setWarned(): Promise<void>;
  /** Shows the warning, with Copy and Cancel (Copy calls `confirmed`). */
  ask(): void;
  /** Puts text on the clipboard. */
  write(text: string): Promise<void>;
  /** A toast: copied, or not. */
  say(outcome: 'copied' | 'failed'): void;
}

export function createCopyLink(host: CopyLinkHost) {
  async function copy(link: string): Promise<CopyOutcome> {
    try {
      await host.write(link);
    } catch {
      // Not the error itself: some clipboard errors could echo what was being written.
      host.say('failed');
      return 'failed';
    }
    host.say('copied');
    return 'copied';
  }

  return {
    /** "Copy stream link" pressed: copies, or first asks (once per profile) about a link that may hold a key. */
    async request(url: string): Promise<CopyOutcome> {
      const found = copyableLink(url);
      if (!found) return 'unavailable';
      if (found.sensitive && !(await host.warned().catch(() => false))) {
        host.ask();
        return 'asked';
      }
      return copy(found.link);
    },
    /** The warning's Copy: remembered, so it isn't asked again, then copied. */
    async confirmed(url: string): Promise<CopyOutcome> {
      const found = copyableLink(url);
      if (!found) return 'unavailable';
      await host.setWarned().catch(() => {});
      return copy(found.link);
    },
  };
}
