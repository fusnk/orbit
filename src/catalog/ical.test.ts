import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine, releaseMoment, uidOf } from './ical';

const octets = (line: string) => new TextEncoder().encode(line).length;

describe('iCalendar text', () => {
  it('escapes backslashes, semicolons, commas and line breaks', () => {
    expect(escapeText('Love, Death; Robots')).toBe('Love\\, Death\\; Robots');
    expect(escapeText('C:\\Films')).toBe('C:\\\\Films');
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
    // Other control characters can't be in a TEXT value: dropped.
    expect(escapeText('a\tb\u0000c\u007fd')).toBe('abcd');
    // C1 controls too (a mis-decoded ’ reads "â\u0080\u0099"): the file Rust checks has none (calendar_file.rs), or the export fails.
    expect(escapeText('It\u00e2\u0080\u0099s\u0085')).toBe('Itâs');
    expect(escapeText('Amélie · 東京')).toBe('Amélie · 東京');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    const long = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(long);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    // Unfolding gives the line back.
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('makes UIDs from safe characters only', () => {
    expect(uidOf('tt0944947:1x5')).toBe('tt0944947:1x5@orbit.release-radar');
    expect(uidOf('tmdb:1 2/3\r\nX')).toBe('tmdb:1-2-3--X@orbit.release-radar');
  });

  it('reads a time of day only when an episode has one', () => {
    expect(releaseMoment('2026-10-20T00:00:00.000Z')).toBeUndefined();
    expect(releaseMoment('2026-10-20')).toBeUndefined();
    expect(releaseMoment(undefined)).toBeUndefined();
    expect(releaseMoment('2026-10-20T01:00:00.000Z')?.toISOString()).toBe('2026-10-20T01:00:00.000Z');
    expect(releaseMoment('2026-10-20T99:99:00Z')).toBeUndefined();
  });
});

describe('a calendar of releases', () => {
  const now = new Date(Date.UTC(2026, 9, 13, 21, 5, 9));
  const text = buildCalendar(
    [
      { uid: 'tt1:1x5', summary: 'Show, The; Return · S1 · E5', day: new Date(2026, 9, 31) },
      { uid: 'tt2:2x1', summary: 'Late show', day: new Date(2026, 9, 20), at: new Date(Date.UTC(2026, 9, 20, 1, 0, 0)) },
    ],
    'Orbit, Release Radar',
    now,
  );
  const lines = text.split('\r\n');

  it('is a VCALENDAR with CRLF lines', () => {
    expect(lines.slice(0, 6)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbit//Release Radar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Orbit\\, Release Radar']);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(2);
  });

  it('writes all-day events with an exclusive end, across a month', () => {
    expect(lines).toContain('UID:tt1:1x5@orbit.release-radar');
    expect(lines).toContain('DTSTAMP:20261013T210509Z');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261031');
    expect(lines).toContain('DTEND;VALUE=DATE:20261101');
    expect(lines).toContain('SUMMARY:Show\\, The\\; Return · S1 · E5');
  });

  it('writes timed events in UTC, an hour long', () => {
    expect(lines).toContain('DTSTART:20261020T010000Z');
    expect(lines).toContain('DTEND:20261020T020000Z');
  });

  it('keeps at most MAX_EVENTS events', () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ uid: `t${i}`, summary: 'x', day: new Date(2026, 0, 1) }));
    expect(buildCalendar(many, 'x', now).split('BEGIN:VEVENT').length - 1).toBe(2000);
  });
});
