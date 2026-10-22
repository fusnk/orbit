/**
 * Runtimes as addons write them: "142 min", "2h 22min", "1 h", or a bare
 * "142". Free text from an addon, so anything else reads as unknown.
 */

/** A runtime in minutes; 0 when missing or unreadable. */
export function runtimeMinutes(runtime: string | undefined): number {
  const text = (runtime ?? '').trim().toLowerCase();
  if (!text) return 0;
  const hours = /(\d+)\s*h/.exec(text);
  const minutes = /(\d+)\s*m/.exec(text);
  const bare = /^\d+$/.test(text) ? Number(text) : 0;
  const total = hours || minutes ? Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0) : bare;
  // Nothing real runs a day or more; a number that large is a typo or a different unit.
  return total > 0 && total < 24 * 60 ? total : 0;
}
