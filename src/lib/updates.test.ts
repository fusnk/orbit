import { describe, expect, it } from 'vitest';
import { plainNotes, whatsNewFor } from './updates';

describe('whatsNewFor', () => {
  it('shows the note only for the version now running', () => {
    expect(whatsNewFor({ version: '1.2.0', notes: 'Faster Home' }, '1.2.0')).toEqual({ version: '1.2.0', notes: 'Faster Home' });
    // The installer was cancelled, or this is an older note.
    expect(whatsNewFor({ version: '1.3.0', notes: 'x' }, '1.2.0')).toBeNull();
    expect(whatsNewFor({ version: '1.1.0', notes: 'x' }, '1.2.0')).toBeNull();
  });

  it('ignores anything that is not a saved note', () => {
    expect(whatsNewFor(null, '1.0.0')).toBeNull();
    expect(whatsNewFor('1.0.0', '1.0.0')).toBeNull();
    expect(whatsNewFor({ version: 1 }, '1')).toBeNull();
    expect(whatsNewFor({ version: '1.0.0', notes: 42 }, '1.0.0')).toEqual({ version: '1.0.0', notes: '' });
  });
});

describe('plainNotes', () => {
  it("turns GitHub's generated notes into plain lines", () => {
    const body = [
      "## What's Changed",
      '* **Live TV** catch-up by @fusnk in https://github.com/fusnk/orbit/pull/12',
      '- Fix [subtitles](https://example.com/x) in `mpv`',
      '',
      '**Full Changelog**: https://github.com/fusnk/orbit/compare/v0.1.0...v0.2.0',
    ].join('\r\n');
    expect(plainNotes(body)).toBe('• Live TV catch-up\n• Fix subtitles in mpv');
  });

  it('drops tags, images, control characters and bidi overrides', () => {
    expect(plainNotes('<script>alert(1)</script>Hi ![x](https://e.com/a.png)\u202Eevil\u0007')).toBe('alert(1)Hi evil');
    expect(plainNotes('<img src=x onerror=alert(1)>Text')).toBe('Text');
  });

  it('keeps it short', () => {
    const long = 'word '.repeat(400);
    const out = plainNotes(long, 50);
    expect([...out].length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
    expect(plainNotes('')).toBe('');
  });
});
