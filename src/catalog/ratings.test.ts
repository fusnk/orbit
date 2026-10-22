import { describe, expect, it } from 'vitest';
import { allows, certificationBand, changeLevel, cleanCertification, limitFor, NO_LIMIT, serverCertificationBand, shownCertification, titleBand, type Band, type ContentLimit } from './ratings';

const cases: [country: string, cert: string, band: Band | null][] = [
  // United States: films and TV
  ['US', 'G', 0],
  ['US', 'PG', 1],
  ['US', 'PG-13', 2],
  ['US', 'R', 3],
  ['US', 'NC-17', 4],
  ['US', 'TV-Y', 0],
  ['US', 'TV-Y7', 0],
  ['US', 'TV-G', 0],
  ['US', 'TV-PG', 1],
  ['US', 'TV-14', 2],
  ['US', 'TV-MA', 3],
  ['US', 'NR', null],
  ['US', 'Unrated', null],
  ['US', '12', null],
  // United Kingdom (BBFC)
  ['GB', 'U', 0],
  ['GB', 'PG', 1],
  ['GB', '12A', 2],
  ['GB', '12', 2],
  ['GB', '15', 3],
  ['GB', '18', 3],
  ['GB', 'R18', 4],
  // Germany (FSK), with and without the prefix
  ['DE', '0', 0],
  ['DE', '6', 0],
  ['DE', '12', 2],
  ['DE', '16', 3],
  ['DE', '18', 3],
  ['DE', 'FSK 12', 2],
  // France: "-12" on TV; 18 is the pornography rating
  ['FR', 'U', 0],
  ['FR', 'TP', 0],
  ['FR', '10', 1],
  ['FR', '-12', 2],
  ['FR', '16', 3],
  ['FR', '18', 4],
  // Netherlands (Kijkwijzer)
  ['NL', 'AL', 0],
  ['NL', '6', 0],
  ['NL', '9', 1],
  ['NL', '12', 2],
  ['NL', '14', 2],
  ['NL', '16', 3],
  ['NL', '18', 3],
  // Spain, Italy, Portugal, Poland, Brazil
  ['ES', 'APTA', 0],
  ['ES', '7', 0],
  ['ES', '12', 2],
  ['ES', '16', 3],
  ['ES', 'X', 4],
  ['IT', 'T', 0],
  ['IT', '6+', 0],
  ['IT', 'VM14', 2],
  ['IT', 'VM18', 3],
  ['PT', 'M/3', 0],
  ['PT', 'M/12', 2],
  ['PT', 'M/16', 3],
  ['PT', 'P', 4],
  ['PL', 'AL', 0],
  ['PL', '7', 0],
  ['PL', '12', 2],
  ['PL', '16', 3],
  ['BR', 'L', 0],
  ['BR', '10', 1],
  ['BR', '14', 2],
  ['BR', '16', 3],
  // Nordics
  ['SE', 'Btl', 0],
  ['SE', '11', 1],
  ['SE', '15', 3],
  ['FI', 'S', 0],
  ['FI', 'K-7', 0],
  ['FI', 'K-12', 2],
  ['FI', 'K-18', 3],
  ['DK', 'A', 0],
  ['NO', '9', 1],
  // Elsewhere
  ['CA', '14A', 2],
  ['CA', '18A', 3],
  ['CA', 'A', 4],
  ['AU', 'G', 0],
  ['AU', 'M', 2],
  ['AU', 'MA15+', 3],
  ['AU', 'R18+', 3],
  ['AU', 'X18+', 4],
  ['NZ', 'R13', 2],
  ['NZ', 'R16', 3],
  ['IE', '15A', 3],
  ['MX', 'AA', 0],
  ['MX', 'B', 2],
  ['MX', 'B-15', 3],
  ['MX', 'D', 4],
  ['AR', 'ATP', 0],
  ['AR', '+13', 2],
  ['AR', '+16', 3],
  ['IN', 'U', 0],
  ['IN', 'UA', 1],
  ['IN', 'U/A 13+', 2],
  ['IN', 'A', 3],
  ['JP', 'G', 0],
  ['JP', 'PG12', 1],
  ['JP', 'R15+', 3],
  ['KR', 'All', 0],
  ['KR', '15', 3],
  ['KR', 'Restricted Screening', 4],
  ['ZA', '7-9PG', 1],
  ['ZA', '13', 2],
  ['ZA', 'X18', 4],
  ['RU', '6+', 0],
  ['RU', '18+', 3],
  // Unknown countries and junk
  ['XX', '12', null],
  ['DE', 'ab12cd', null],
  ['DE', '99', null],
  ['GB', '', null],
];

describe('certificationBand', () => {
  it.each(cases)('%s %s → %s', (country, cert, band) => {
    expect(certificationBand(country, cert)).toBe(band);
  });

  it('ignores case and spacing', () => {
    expect(certificationBand('US', 'pg-13')).toBe(2);
    expect(certificationBand('AU', ' ma15+ ')).toBe(3);
    expect(certificationBand('US', undefined)).toBeNull();
  });
});

describe('titleBand', () => {
  it("reads the person's country first, then the US", () => {
    expect(titleBand({ US: 'R', GB: '15', DE: '12' }, 'DE')).toBe(2);
    expect(titleBand({ US: 'PG' }, 'DE')).toBe(1);
    // A rating Orbit can't read in the person's country falls back to the US one.
    expect(titleBand({ US: 'PG-13', DE: 'Unbekannt' }, 'DE')).toBe(2);
    expect(shownCertification({ US: 'PG-13', DE: 'Unbekannt' }, 'DE')).toBe('PG-13');
    expect(shownCertification({ US: 'PG-13', GB: '12A' }, 'GB')).toBe('12A');
    expect(titleBand({}, 'GB')).toBeNull();
  });

  it('reads the strictest other country when neither the person’s nor the US has a rating, rather than calling it unrated', () => {
    // Rated only in Germany (FSK 18) and Japan: not "unrated", which Teens shows by default.
    expect(titleBand({ DE: '18', JP: 'G' }, 'GB')).toBe(3);
    expect(shownCertification({ DE: '18', JP: 'G' }, 'GB')).toBe('18');
    expect(titleBand({ FR: '18' }, 'GB')).toBe(4);
    expect(shownCertification({ FR: '18' }, 'GB')).toBe('18');
    // Only ratings Orbit can read count; none at all is still unrated.
    expect(titleBand({ DE: 'Unbekannt', XX: '12' }, 'GB')).toBeNull();
    // The person's country or the US still come first, even when laxer.
    expect(titleBand({ US: 'PG', KR: '19' }, 'GB')).toBe(1);
  });

  it("puts TMDB's adult flag above any certification", () => {
    expect(titleBand({ US: 'G' }, 'US', true)).toBe(4);
  });
});

describe('serverCertificationBand', () => {
  it('reads a Jellyfin or Plex rating, with or without its country', () => {
    // Plex's "de/16", Jellyfin's "DE-16" and "FSK-16": that country's rules.
    expect(serverCertificationBand('de/16', 'US')).toBe(3);
    expect(serverCertificationBand('DE-16', 'US')).toBe(3);
    expect(serverCertificationBand('FSK-16', 'US')).toBe(3);
    expect(serverCertificationBand('gb/12A', 'US')).toBe(2);
    // Jellyfin's "UK-15" (not an ISO code).
    expect(serverCertificationBand('UK-15', 'US')).toBe(3);
    // No country: the person's, then the US's ("TV-MA" isn't Tuvalu's "MA").
    expect(serverCertificationBand('TV-MA', 'GB')).toBe(3);
    expect(serverCertificationBand('PG-13', 'GB')).toBe(2);
    expect(serverCertificationBand('12A', 'GB')).toBe(2);
    expect(serverCertificationBand('NC-17', 'DE')).toBe(4);
    // Nothing Orbit can read: unrated.
    expect(serverCertificationBand('NR', 'US')).toBeNull();
    expect(serverCertificationBand('Not Rated', 'US')).toBeNull();
    expect(serverCertificationBand(undefined, 'US')).toBeNull();
  });
});

describe('allows', () => {
  const kids = limitFor('kids');
  const older = limitFor('older-kids');
  const teens = limitFor('teens');
  const noAdult = limitFor('no-adult');

  it('lets each level see its bands and the ones below', () => {
    const shown = (limit: ContentLimit) => ([0, 1, 2, 3, 4] as const).filter((band) => allows(limit, band));
    expect(shown(kids)).toEqual([0]);
    expect(shown(older)).toEqual([0, 1]);
    expect(shown(teens)).toEqual([0, 1, 2]);
    expect(shown(noAdult)).toEqual([0, 1, 2, 3]);
    expect(shown(NO_LIMIT)).toEqual([0, 1, 2, 3, 4]);
  });

  it('hides unrated titles for children and shows them for teens, unless changed', () => {
    expect(allows(kids, null)).toBe(false);
    expect(allows(older, null)).toBe(false);
    expect(allows(teens, null)).toBe(true);
    expect(allows(noAdult, null)).toBe(true);
    expect(allows({ ...kids, allowUnrated: true }, null)).toBe(true);
    expect(allows({ ...teens, allowUnrated: false }, null)).toBe(false);
    expect(allows({ ...NO_LIMIT, allowUnrated: false }, null)).toBe(true);
  });

  it('starts Live TV hidden only for children', () => {
    expect([kids, older, teens, noAdult].map((l) => l.allowLiveTv)).toEqual([false, false, true, true]);
  });
});

describe('cleanCertification', () => {
  it('keeps a rating as one short line of printable text', () => {
    expect(cleanCertification(' PG-13 ')).toBe('PG-13');
    expect(cleanCertification('U/A 13+')).toBe('U/A 13+');
    expect(cleanCertification('TV\nMA')).toBe('TV MA');
    expect(cleanCertification('R\u200b\u0007')).toBe('R');
    expect(cleanCertification('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKL');
  });

  it('gives nothing for blanks', () => {
    expect(cleanCertification('')).toBeNull();
    expect(cleanCertification('  \u200b ')).toBeNull();
    expect(cleanCertification(null)).toBeNull();
    expect(cleanCertification(undefined)).toBeNull();
  });
});

describe('choosing another level', () => {
  it('keeps a switch turned off when the level gets stricter', () => {
    const noAdult: ContentLimit = { level: 'no-adult', allowUnrated: true, allowLiveTv: false };
    expect(changeLevel(noAdult, 'teens')).toEqual({ level: 'teens', allowUnrated: true, allowLiveTv: false });
    expect(changeLevel({ ...noAdult, allowUnrated: false }, 'teens')).toEqual({ level: 'teens', allowUnrated: false, allowLiveTv: false });
    // Stricter levels' own defaults still apply.
    expect(changeLevel(limitFor('teens'), 'kids')).toEqual(limitFor('kids'));
  });

  it('starts a looser level, or the first limit, from its defaults', () => {
    expect(changeLevel(limitFor('kids'), 'teens')).toEqual(limitFor('teens'));
    expect(changeLevel(NO_LIMIT, 'no-adult')).toEqual(limitFor('no-adult'));
    expect(changeLevel(limitFor('teens'), 'off')).toEqual(NO_LIMIT);
  });
});
