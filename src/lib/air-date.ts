/**
 * When a `released` date counts as out, in ms (NaN when missing or not a date).
 *
 * Addons give a date-only air date as UTC midnight ("2026-10-20T00:00:00.000Z")
 * or as "2026-10-20". It names a calendar day, not a moment: read as UTC
 * midnight it's the evening before across the Americas, so an episode would
 * count as out hours early. It's out from the start of that day where the
 * person is. Any other time of day is a real moment and kept.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/;

/** Whether `released` names a calendar day (see `releasedAt`) rather than a moment. */
export const isAirDate = (released: string | undefined): boolean => DATE_ONLY.test(released ?? '');

export function releasedAt(released: string | undefined): number {
  const date = DATE_ONLY.exec(released ?? '');
  if (!date) return released ? Date.parse(released) : NaN;
  const [year, month, day] = [Number(date[1]), Number(date[2]) - 1, Number(date[3])];
  const at = new Date(year, month, day);
  // Rejects dates that roll over ("2026-02-30").
  return at.getMonth() === month && at.getDate() === day ? at.getTime() : NaN;
}
