/**
 * The player's "Couldn't …" toasts show a translated line as it is. Two of
 * them used to glue an ASCII full stop onto the sentence, which read wrong in
 * languages whose stop is another mark (。) or none, and unlike every other
 * toast in the player. Read from the source as text, like the stylesheet tests.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/locales/en';
import player from './index.ts?raw';

describe('player toasts', () => {
  it('show a translated line without a glued full stop', () => {
    const glued = player.match(/toast\(`\$\{[^`]*\}\.`\)/g) ?? [];
    expect(glued).toEqual([]);
  });

  it("take the error lines whole: none ends in a full stop that a toast would add", () => {
    const stops = Object.entries(en).filter(([key, text]) => /^player\.error\.(seek|skip|pause|volume|unmute|mute|subtitles-toggle)$/.test(key) && /[.。]$/.test(text));
    expect(stops).toEqual([]);
  });
});
