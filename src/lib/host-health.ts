/**
 * Per-host health, alongside the per-source memory in failed-sources.ts:
 * when a host (a stream URL's domain, or for a torrent the addon) has failed
 * to play at least twice in the last half hour, with more failures than
 * successes, every source from it ranks after the others for a while. One
 * success clears it, and failures older than the window no longer count.
 *
 * In memory only, and keyed by host name alone: never a full URL, which can
 * hold a debrid key.
 */

export const HOST_WINDOW_MS = 30 * 60_000;
export const HOST_MIN_FAILURES = 2;
/** Hosts remembered at most; the longest-quiet go first. */
const MAX_HOSTS = 200;

/**
 * Where a source plays from: the URL's host name, or (a magnet, a local or
 * odd address) the addon, as `addon:<name>`.
 */
export function hostOf(url: string, addon: string): string {
  if (/^https?:/i.test(url)) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host) return host;
    } catch {
      // Not a parsable URL: fall through to the addon.
    }
  }
  return `addon:${addon}`;
}

export function createHostHealth(now: () => number = Date.now) {
  /** Each host's failure times since its last success (a Map keeps the most recently touched last). */
  const hosts = new Map<string, number[]>();

  const recent = (host: string) => {
    const at = now();
    const list = (hosts.get(host) ?? []).filter((t) => at - t < HOST_WINDOW_MS && t <= at);
    if (list.length) hosts.set(host, list);
    else hosts.delete(host);
    return list;
  };

  return {
    failed(host: string): void {
      const list = recent(host);
      hosts.delete(host);
      hosts.set(host, [...list, now()]);
      while (hosts.size > MAX_HOSTS) hosts.delete(hosts.keys().next().value!);
    },
    /** It played: whatever it failed before is forgiven. */
    succeeded(host: string): void {
      hosts.delete(host);
    },
    /** Failures since the last success can only outnumber the successes since (none), so two in the window is enough. */
    unhealthy(host: string): boolean {
      return hosts.has(host) && recent(host).length >= HOST_MIN_FAILURES;
    },
    /** Nothing failed lately anywhere: ranking can skip looking. */
    empty: () => hosts.size === 0,
  };
}

/** The app's one record (playback failures from the player, ranking in the source list). */
export const hostHealth = createHostHealth();

/** Keeps the order, with sources from unhealthy hosts moved after the rest. */
export function unhealthyLast<T>(sources: readonly T[], where: (source: T) => { url: string; addon: string }): T[] {
  if (hostHealth.empty()) return [...sources];
  const bad = (s: T) => {
    const { url, addon } = where(s);
    return hostHealth.unhealthy(hostOf(url, addon));
  };
  return [...sources.filter((s) => !bad(s)), ...sources.filter(bad)];
}
