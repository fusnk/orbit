/**
 * Content limits on profiles: which certifications each level allows.
 *
 * Every country's certification is mapped to one of five age bands, so a
 * limit means the same thing whichever country's rating is read:
 *   0 young kids (US G, TV-Y, TV-Y7, TV-G; UK U; FSK 0/6)
 *   1 older kids (PG, TV-PG; ages 8–11)
 *   2 teens      (PG-13, TV-14; UK 12/12A; FSK 12; ages 12–14)
 *   3 mature     (R, TV-MA; UK 15/18; FSK 16/18; ages 15+)
 *   4 adult only (NC-17, X, UK R18 and the like: sexually explicit ratings)
 * The person's country is read first, then the US, then the strictest
 * other country's. Pure, no I/O.
 */

export const LEVELS = ['off', 'kids', 'older-kids', 'teens', 'no-adult'] as const;
export type Level = (typeof LEVELS)[number];

export interface ContentLimit {
  level: Level;
  /** Titles without a rating Orbit could find are shown. */
  allowUnrated: boolean;
  /** Live TV (channels carry no ratings) is shown. */
  allowLiveTv: boolean;
}

export const NO_LIMIT: ContentLimit = { level: 'off', allowUnrated: true, allowLiveTv: true };

export type Band = 0 | 1 | 2 | 3 | 4;

/** The highest band each level shows. */
const MAX_BAND: Record<Exclude<Level, 'off'>, Band> = { kids: 0, 'older-kids': 1, teens: 2, 'no-adult': 3 };

/**
 * A level's starting choices: for young children an unrated title or a TV
 * channel could be anything, so both start hidden; for teens and older,
 * hiding everything TMDB hasn't rated would hide too much.
 */
export function limitFor(level: Level): ContentLimit {
  const lenient = level === 'off' || level === 'teens' || level === 'no-adult';
  return { level, allowUnrated: lenient, allowLiveTv: lenient };
}

/** Higher is stricter, as in profiles.rs `Level::strictness`. */
const STRICTNESS: Record<Level, number> = { off: 0, 'no-adult': 1, teens: 2, 'older-kids': 3, kids: 4 };

/**
 * The limit after choosing `level` in the editor. A looser level starts from
 * its own defaults; a stricter one keeps a switch the person turned off, off:
 * a tightening mustn't quietly bring Live TV or unrated titles back (Rust
 * would count that as loosening, and ask a child's profile for a parent).
 */
export function changeLevel(current: ContentLimit, level: Level): ContentLimit {
  const next = limitFor(level);
  if (current.level === 'off' || STRICTNESS[level] < STRICTNESS[current.level]) return next;
  return { level, allowUnrated: next.allowUnrated && current.allowUnrated, allowLiveTv: next.allowLiveTv && current.allowLiveTv };
}

/** Whether `limit` shows a title in `band` (null: unrated or unknown). */
export function allows(limit: ContentLimit, band: Band | null): boolean {
  if (limit.level === 'off') return true;
  if (band === null) return limit.allowUnrated;
  return band <= MAX_BAND[limit.level];
}

/** Ratings that are only a number of years ("12", "16+", "K-12", "M/16", "VM14") in these countries. */
const NUMERIC = new Set(['DE', 'AT', 'CH', 'NL', 'BE', 'ES', 'IT', 'PT', 'PL', 'BR', 'AR', 'SE', 'NO', 'DK', 'FI', 'IS', 'IE', 'KR', 'ZA', 'RU', 'UA', 'TR', 'GR', 'HU', 'CZ', 'SK', 'RO', 'BG', 'HR', 'SI', 'LT', 'LV', 'EE', 'FR', 'MX', 'CL', 'CO', 'PE', 'TW', 'HK', 'SG', 'MY', 'PH', 'TH', 'ID', 'IL', 'AE', 'SA', 'EG']);

/** Ratings with letters, per country (upper case, spaces removed). Checked before the numeric reading. */
const TABLES: Record<string, Record<string, Band>> = {
  US: { G: 0, PG: 1, 'PG-13': 2, R: 3, 'NC-17': 4, X: 4, 'TV-Y': 0, 'TV-Y7': 0, 'TV-Y7-FV': 0, 'TV-G': 0, 'TV-PG': 1, 'TV-14': 2, 'TV-MA': 3 },
  GB: { U: 0, UC: 0, PG: 1, '12A': 2, '12': 2, '15': 3, '18': 3, R18: 4 },
  IE: { G: 0, PG: 1, '12A': 2, '15A': 3, '16': 3, '18': 3 },
  CA: { G: 0, PG: 1, '14A': 2, '18A': 3, R: 3, A: 4, C: 0, C8: 0, '14+': 2, '18+': 3 },
  AU: { G: 0, P: 0, C: 0, PG: 1, M: 2, MA: 3, 'MA15+': 3, 'AV15+': 3, 'R18+': 3, R: 3, 'X18+': 4, X: 4 },
  NZ: { G: 0, PG: 1, M: 2, R13: 2, RP13: 2, R15: 3, R16: 3, RP16: 3, R18: 3, RP18: 3, R: 3 },
  // France's "18" (interdit aux moins de 18 ans) is mostly given to pornography.
  FR: { U: 0, TP: 0, '18': 4 },
  NL: { AL: 0, '9': 1, '14': 2 },
  BE: { AL: 0, KT: 0, ENA: 3, KNT: 3 },
  ES: { A: 0, APTA: 0, TP: 0, AI: 0, '7I': 0, X: 4 },
  IT: { T: 0 },
  PT: { P: 4 },
  PL: { AL: 0 },
  BR: { L: 0, AL: 0, ER: 0 },
  MX: { AA: 0, A: 0, B: 2, B15: 3, 'B-15': 3, C: 3, D: 4 },
  AR: { ATP: 0, C: 3 },
  SE: { BTL: 0 },
  NO: { A: 0 },
  DK: { A: 0 },
  FI: { S: 0 },
  KR: { ALL: 0, RESTRICTEDSCREENING: 4 },
  ZA: { A: 0, PG: 1, '7-9PG': 1, '10-12PG': 1, X18: 4, XX: 4 },
  IN: { U: 0, UA: 1, 'U/A': 1, 'UA7+': 0, 'U/A7+': 0, 'UA13+': 2, 'U/A13+': 2, 'UA16+': 3, 'U/A16+': 3, A: 3 },
  JP: { G: 0, PG12: 1, 'R15+': 3, 'R18+': 3 },
};

/** The band for a minimum age. */
export function ageBand(age: number): Band {
  if (age <= 7) return 0;
  if (age <= 11) return 1;
  if (age <= 14) return 2;
  return 3;
}

/** Upper case, without spaces or a leading dash/plus ("-12" on French TV, "+13" in Argentina). */
const normalize = (cert: string) => cert.toUpperCase().replace(/\s+/g, '').replace(/^[-+]/, '');

/** The band of one country's certification, or null if it isn't one Orbit knows ("NR", "Unrated", blanks). */
export function certificationBand(country: string, cert: string | undefined): Band | null {
  if (!cert) return null;
  const key = normalize(cert);
  const listed = TABLES[country]?.[key];
  if (listed !== undefined) return listed;
  if (!NUMERIC.has(country)) return null;
  // An optional short prefix (FSK, K-, M/, VM), the age, an optional "+".
  const age = /^(?:[A-Z]{1,3}[-/]?)?(\d{1,2})\+?$/.exec(key)?.[1];
  return age !== undefined && Number(age) <= 21 ? ageBand(Number(age)) : null;
}

/**
 * The certification a title's band is read from: the person's region first,
 * then the US; failing both, the strictest other country's. A title rated
 * only abroad (FSK 18 in Germany, say) isn't unrated: Teens and "All but
 * adult" show unrated titles by default, and would let it through.
 */
function deciding(certs: Readonly<Record<string, string>>, region: string): { cert: string; band: Band } | null {
  for (const country of [region, 'US']) {
    const band = certificationBand(country, certs[country]);
    if (band !== null) return { cert: certs[country]!, band };
  }
  let strictest: { cert: string; band: Band } | null = null;
  for (const [country, cert] of Object.entries(certs)) {
    const band = certificationBand(country, cert);
    if (band !== null && (!strictest || band > strictest.band)) strictest = { cert, band };
  }
  return strictest;
}

/**
 * A title's band from its certifications by country (see `deciding`). TMDB's
 * adult flag outranks any certification. Null when no country has a rating
 * Orbit knows.
 */
export function titleBand(certs: Readonly<Record<string, string>>, region: string, adult = false): Band | null {
  if (adult) return 4;
  return deciding(certs, region)?.band ?? null;
}

/**
 * The band of a rating from the person's own Jellyfin or Plex server, for a
 * title TMDB can't rate (no IMDb id): Plex writes "de/16", Jellyfin "DE-16",
 * "UK-15" or plain "PG-13". With a country, that country's rules; without
 * one (or one Orbit can't read it for, like "TV" in "TV-MA"), the US's
 * letter ratings, then the person's country. Null when it isn't a rating
 * Orbit knows.
 */
export function serverCertificationBand(cert: string | null | undefined, region: string): Band | null {
  const text = cert?.trim();
  if (!text) return null;
  const prefixed = /^([a-z]{2})[/-](.+)$/i.exec(text);
  if (prefixed) {
    const country = prefixed[1]!.toUpperCase();
    const band = certificationBand(country === 'UK' ? 'GB' : country, prefixed[2]);
    if (band !== null) return band;
  }
  // The US's letter ratings first: they say what they are, where a region's age reading would take "NC-17" for 17.
  return certificationBand('US', text) ?? certificationBand(region, text) ?? (/^FSK/i.test(text) ? certificationBand('DE', text) : null);
}

/** Longer than any real rating ("TV-Y7-FV", "U/A 13+"); parental.ts checks Rust's answer against the same cap. */
const MAX_CERT_LENGTH = 12;

/** A certification as a badge shows it (it's untrusted text): one line, printable, capped; null when nothing is left. */
export function cleanCertification(cert: string | null | undefined): string | null {
  const text = (cert ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  return text ? [...text].slice(0, MAX_CERT_LENGTH).join('').trim() : null;
}

/** The certification shown with a band: the one it was read from. */
export function shownCertification(certs: Readonly<Record<string, string>>, region: string): string | null {
  return deciding(certs, region)?.cert ?? null;
}
