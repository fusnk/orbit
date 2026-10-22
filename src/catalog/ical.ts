/**
 * An iCalendar file (RFC 5545) of releases, for Release Radar's "Export to
 * calendar (.ics)". Pure: the page builds the text, Rust checks its shape and
 * writes it where the person chose (calendar_file.rs). Only names, episode
 * codes and dates go in; never a link.
 */

export interface CalendarEvent {
  /** Stable for the same release, so importing again updates rather than duplicates. */
  uid: string;
  summary: string;
  /** All day on this local date… */
  day: Date;
  /** …or, when known, at this moment (written in UTC, an hour long). */
  at?: Date | undefined;
}

/** Most calendar apps choke on huge imports; the Radar never has this many. */
export const MAX_EVENTS = 2000;
const MAX_SUMMARY = 200;
/** RFC 5545 §3.1: content lines are folded at 75 octets. */
const LINE_OCTETS = 75;

/** Text as an iCalendar TEXT value: backslash, semicolon and comma escaped, line breaks as \n, other controls (C0, DEL and C1, as calendar_file.rs refuses them) dropped. */
export function escapeText(text: string): string {
  const plain = [...text.replace(/\r\n|\r/g, '\n')].filter((c) => c === '\n' || (c >= ' ' && (c < '\u007f' || c > '\u009f'))).join('');
  return plain.replace(/[\\;,\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`));
}

/** One content line, folded at 75 octets (UTF-8) without splitting a character; continuation lines start with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // The first line has 75 octets; each continuation's leading space takes one of its 75.
    const limit = parts.length ? LINE_OCTETS - 1 : LINE_OCTETS;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
/** A local date as YYYYMMDD. */
const dateValue = (d: Date) => `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
/** A moment as UTC YYYYMMDDTHHMMSSZ. */
const utcValue = (d: Date) => `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** A UID that's safe as is: letters, digits and a few separators, under Orbit's domain-style suffix. */
export const uidOf = (key: string) => `${key.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120)}@orbit.release-radar`;

/** The whole file, CRLF line endings, events in the order given (at most MAX_EVENTS). */
export function buildCalendar(events: readonly CalendarEvent[], name: string, now: Date): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbit//Release Radar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
  const stamp = utcValue(now);
  for (const event of events.slice(0, MAX_EVENTS)) {
    lines.push('BEGIN:VEVENT', `UID:${uidOf(event.uid)}`, `DTSTAMP:${stamp}`);
    if (event.at && Number.isFinite(event.at.getTime())) {
      lines.push(`DTSTART:${utcValue(event.at)}`, `DTEND:${utcValue(new Date(event.at.getTime() + 3_600_000))}`);
    } else {
      // All-day: DTEND is the next day (exclusive), as RFC 5545 has it.
      const next = new Date(event.day.getFullYear(), event.day.getMonth(), event.day.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${dateValue(event.day)}`, `DTEND;VALUE=DATE:${dateValue(next)}`);
    }
    lines.push(`SUMMARY:${escapeText([...event.summary].slice(0, MAX_SUMMARY).join(''))}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * When an episode's `released` names a time of day (not just a date at
 * midnight UTC, which is how most addons give a date), that moment.
 */
export function releaseMoment(released: string | undefined): Date | undefined {
  const match = released?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  if (!match || (match[1] === '00' && match[2] === '00')) return undefined;
  const at = new Date(released!);
  return Number.isFinite(at.getTime()) ? at : undefined;
}
