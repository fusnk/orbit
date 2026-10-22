import { describe, expect, it } from 'vitest';
import { fuzzyScore, normalize, prepare } from './fuzzy';

const score = (query: string, text: string, loose = true) => fuzzyScore(prepare(query), prepare(text), loose);
/** `texts` ordered best match first, leaving out the ones that don't match. */
const rank = (query: string, texts: string[]) =>
  texts
    .map((text) => ({ text, s: score(query, text) }))
    .filter((r) => r.s !== null)
    .sort((a, b) => b.s! - a.s!)
    .map((r) => r.text);

describe('fuzzyScore', () => {
  it('ranks exact, prefix, word start, words, inside, then letters in order', () => {
    expect(rank('sub', ['Subtitles', 'Sub', 'Preferred subtitle language', 'Hide spoilers', 'Dubbed sub-par', 'Sync subtitles automatically'])).toEqual([
      'Sub',
      'Subtitles',
      'Dubbed sub-par',
      'Preferred subtitle language',
      'Sync subtitles automatically',
    ]);
    expect(rank('play', ['Autoplay next episode', 'Playback', 'Player'])).toEqual(['Player', 'Playback', 'Autoplay next episode']);
    expect(score('hwd', 'Hardware decoding')).not.toBeNull();
    expect(score('hwd', 'Hardware decoding')!).toBeLessThan(score('hard', 'Hardware decoding')!);
  });

  it('matches every query word in any order', () => {
    expect(score('sub size', 'Subtitle size')).not.toBeNull();
    expect(score('size sub', 'Subtitle size')).not.toBeNull();
    expect(score('size sub', 'Subtitle size')!).toBeGreaterThan(score('ubt', 'Subtitle size')!);
    expect(score('sub colour', 'Subtitle size')).toBeNull();
  });

  it('letters in order must start at a word', () => {
    expect(score('ae', 'Hardware decoding')).toBeNull();
    expect(score('dc', 'Hardware decoding')).not.toBeNull();
    expect(score('hwd', 'Hardware decoding')).not.toBeNull();
    expect(score('rtwm', 'Race to Witch Mountain')).not.toBeNull();
    // Letters from the middles of different words don't count.
    expect(score('ronin', 'Race to Witch Mountain')).toBeNull();
    // Not for long texts like keywords.
    expect(score('hwd', 'Hardware decoding', false)).toBeNull();
    expect(score('ware', 'Hardware decoding', false)).not.toBeNull();
  });

  it('ignores case, accents and punctuation', () => {
    expect(score('pokemon', 'Pokémon')).toBe(score('pokémon', 'Pokémon'));
    expect(score('AMELIE', 'Amélie')).not.toBeNull();
    expect(score('lodz', 'Łódź')).not.toBeNull();
    expect(score('spiderman', 'Spider-Man')).not.toBeNull();
    expect(score('spider man', 'Spider-Man')).toBe(score('spider-man', 'Spider-Man'));
    expect(normalize('  Ça  va? ')).toBe('ca va');
  });

  it('works for Arabic: hamza forms, tashkeel, tatweel, ta marbuta and alef maqsura', () => {
    expect(score('اعدادات', 'إعدادات')).toBe(score('إعدادات', 'إعدادات'));
    expect(score('مشاهدة', 'مُشَاهَدَة')).not.toBeNull();
    expect(score('مكتبه', 'مكتبة')).not.toBeNull();
    expect(score('مستوى', 'مستوي')).not.toBeNull();
    expect(score('ترجمة', 'ترجـــمة')).not.toBeNull();
    // Arabic words are words: a word start beats a match inside one.
    expect(rank('ترجم', ['لغة الترجمة', 'ترجمات تلقائية', 'حجم الترجمة'])[0]).toBe('ترجمات تلقائية');
    expect(score('صوت', 'الترجمات')).toBeNull();
  });

  it('an empty query matches everything; nothing matches an empty text', () => {
    expect(score('', 'Anything')).toBe(0);
    expect(score('   ', 'Anything')).toBe(0);
    expect(score('a', '')).toBeNull();
    expect(score('?!', 'Anything')).toBe(0);
  });

  it('shorter texts win within a tier, never across tiers', () => {
    expect(score('sub', 'Subtitles')!).toBeGreaterThan(score('sub', 'Subtitles and audio tracks for everything')!);
    const longPrefix = score('sub', `Sub${'x'.repeat(300)}`)!;
    expect(longPrefix).toBeGreaterThan(score('sub', 'A sub')!);
  });
});
