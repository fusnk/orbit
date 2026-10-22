import { describe, expect, it } from 'vitest';
import { canStepChapter, chapterName, currentChapter } from './chapters';

const chapters = [
  { title: 'Opening', time: 0 },
  { title: null, time: 90 },
  { title: '  ', time: 600 },
];

describe('currentChapter', () => {
  it('is the last chapter to start at or before the position', () => {
    expect(currentChapter(chapters, 0)).toBe(0);
    expect(currentChapter(chapters, 89)).toBe(0);
    expect(currentChapter(chapters, 90)).toBe(1);
    expect(currentChapter(chapters, 5000)).toBe(2);
  });

  it('counts a seek that lands just short of a chapter as that chapter', () => {
    expect(currentChapter(chapters, 89.9)).toBe(1);
  });

  it('is none without a position, before the first chapter, or without chapters', () => {
    expect(currentChapter(chapters, null)).toBe(-1);
    expect(currentChapter([{ title: 'Late', time: 30 }], 10)).toBe(-1);
    expect(currentChapter([], 10)).toBe(-1);
  });
});

describe('chapterName', () => {
  it('uses the file’s title, or numbers an untitled chapter', () => {
    expect(chapterName(chapters[0]!, 0)).toBe('Opening');
    expect(chapterName(chapters[1]!, 1)).toBe('Chapter 2');
    expect(chapterName(chapters[2]!, 2)).toBe('Chapter 3');
  });
});

describe('canStepChapter', () => {
  it('steps only once a file with chapters plays: mpv refuses the step without any, which showed as an error', () => {
    expect(canStepChapter(chapters, true)).toBe(true);
    expect(canStepChapter([], true)).toBe(false);
    expect(canStepChapter(chapters, false)).toBe(false);
  });
});
