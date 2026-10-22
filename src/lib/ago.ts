/**
 * A past moment as people say it: "5 minutes ago", "3 hours ago", "2 days
 * ago", in the language of `tag`. Null under a minute, which callers word
 * themselves ("just now", "synced just now").
 */
export function agoText(at: number, now: number, tag: string): string | null {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return null;
  const relative = new Intl.RelativeTimeFormat(tag);
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return hours < 48 ? relative.format(-hours, 'hour') : relative.format(-Math.round(hours / 24), 'day');
}
