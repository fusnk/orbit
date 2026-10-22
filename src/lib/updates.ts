/**
 * "What's new" after an update: which note to show, and the release notes
 * as plain text. The notes come from the release (via the updater), so they
 * are treated as untrusted: tags, Markdown and links are reduced to their
 * text, and the result is only ever set as `textContent`.
 */

export interface WhatsNew {
  version: string;
  notes: string;
}

/** How much of the notes the note shows; the full text is on the release page. */
const MAX_CHARS = 600;
/** Lines GitHub adds to generated notes that mean nothing inside Orbit. */
const NOISE = /^(what'?s changed|full changelog:?|new contributors)$/i;

/** The saved note, if it belongs to the version now running (so it shows once, after that update). */
export function whatsNewFor(saved: unknown, current: string): WhatsNew | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { version, notes } = saved as Record<string, unknown>;
  if (typeof version !== 'string' || version !== current) return null;
  return { version, notes: typeof notes === 'string' ? plainNotes(notes) : '' };
}

/** Release notes (Markdown, maybe HTML) as short plain text, one item per line. */
export function plainNotes(text: string, max = MAX_CHARS): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Control characters and bidi overrides, which could reorder the text around them.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*+]\s+/, '• ')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s*\bhttps?:\/\/\S+/g, '')
        // "… by @someone in" (the pull request link is already gone).
        .replace(/\s+by @[\w-]+(\s+in)?\s*$/, '')
        .trim(),
    )
    .filter((line) => line && line !== '•' && !NOISE.test(line));
  const joined = lines.join('\n');
  const chars = [...joined];
  return chars.length <= max ? joined : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
