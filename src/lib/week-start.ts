/**
 * Which day a week starts on, for a month grid: 0 = Sunday … 6 = Saturday
 * (as `Date.getDay`). Asked of the browser's locale data (`Intl.Locale`'s
 * week info) where it has it; the table below covers the rest, and is
 * deliberately short: Monday is the usual answer, Sunday for the regions
 * that use it, Saturday for a few in the Middle East.
 */

const SUNDAY_REGIONS = new Set(['US', 'CA', 'MX', 'BR', 'JP', 'KR', 'TW', 'HK', 'IL', 'IN', 'PH', 'ZA', 'AU', 'NZ']);
const SATURDAY_REGIONS = new Set(['AE', 'SA', 'EG', 'IQ', 'JO', 'KW', 'LY', 'OM', 'QA', 'SY', 'BH', 'DZ', 'AF', 'IR']);
/** Languages whose usual region is covered, when the tag names none. */
const SUNDAY_LANGUAGES = new Set(['ja', 'ko', 'zh', 'he', 'pt-BR']);
const SATURDAY_LANGUAGES = new Set(['ar', 'fa']);

/** Intl's week info: `firstDay` 1 = Monday … 7 = Sunday (a getter on some engines, a method on others). */
interface WithWeekInfo {
  weekInfo?: { firstDay: number };
  getWeekInfo?: () => { firstDay: number };
}

export function firstDayOfWeek(tag: string): number {
  try {
    const parsed = new Intl.Locale(tag);
    const info = (parsed as WithWeekInfo).getWeekInfo?.() ?? (parsed as WithWeekInfo).weekInfo;
    if (info && Number.isInteger(info.firstDay) && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7;
    return fromTable(parsed.language, parsed.region);
  } catch {
    const [language = '', region] = tag.split(/[-_]/);
    return fromTable(language.toLowerCase(), region?.toUpperCase());
  }
}

function fromTable(language: string, region: string | undefined): number {
  if (region && SUNDAY_REGIONS.has(region)) return 0;
  if (region && SATURDAY_REGIONS.has(region)) return 6;
  if (region) return 1;
  if (SUNDAY_LANGUAGES.has(language)) return 0;
  if (SATURDAY_LANGUAGES.has(language)) return 6;
  return 1;
}

/** The seven weekdays in grid order, from `firstDay`, as `Date.getDay` numbers. */
export const weekdayOrder = (firstDay: number): number[] => Array.from({ length: 7 }, (_, i) => (firstDay + i) % 7);

/** How many days of the previous month lead the grid before the 1st (`first`), with weeks from `firstDay`. */
export const leadingDays = (first: Date, firstDay: number): number => (first.getDay() - firstDay + 7) % 7;
