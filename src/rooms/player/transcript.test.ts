import { describe, expect, it } from 'vitest';
import { currentCues, cueSeekTime, FOLLOW_RESUME_MS, matchSlices, nextMatch, shouldFollow, transcriptEscape, transcriptIndices } from './transcript';
const cues = [{ start: 10, end: 20, text: '<b>Hello</b> world' }, { start: 15, end: 22, text: 'HELLO again' }, { start: 30, end: 40, text: 'Future secret' }];
describe('transcript rules', () => {
  it('hides future lines and their search results/counts before filtering', () => {
    expect(transcriptIndices(cues, 12, 0, false, 'hello')).toEqual([0]);
    expect(transcriptIndices(cues, 12, 0, false, 'secret')).toEqual([]);
    expect(transcriptIndices(cues, 12, 0, true, 'SECRET')).toEqual([2]);
  });
  it('applies positive and negative delay to visibility, overlapping currents and seeks', () => {
    expect(transcriptIndices(cues, 10, 2, false, '')).toEqual([]);
    expect(currentCues(cues, 18, 2)).toEqual([0, 1]);
    expect(currentCues(cues, 22, 2)).toEqual([1]);
    expect(cueSeekTime(cues[0]!, -12)).toBe(0);
    expect(cueSeekTime(cues[0]!, 2)).toBe(12);
  });
  it('clears search before closing, including whitespace-only queries', () => {
    expect(transcriptEscape('test')).toBe('clear');
    expect(transcriptEscape(' ')).toBe('clear');
    expect(transcriptEscape('')).toBe('close');
  });
  it('wraps next/previous matches and handles no active or no results', () => {
    expect(nextMatch([1, 3], 3, 1)).toBe(1);
    expect(nextMatch([1, 3], 1, -1)).toBe(3);
    expect(nextMatch([1, 3], -1, -1)).toBe(3);
    expect(nextMatch([], -1, 1)).toBeUndefined();
  });
  it('waits after deliberate scrolling but resumes after the interval', () => {
    expect(shouldFollow(100 + FOLLOW_RESUME_MS - 1, 100)).toBe(false);
    expect(shouldFollow(100 + FOLLOW_RESUME_MS, 100)).toBe(true);
  });
  it('returns safe text slices, matching repeated case-insensitive occurrences', () => {
    expect(matchSlices('<img>Hello HELLO', 'hello')).toEqual([{ text: '<img>', match: false }, { text: 'Hello', match: true }, { text: ' ', match: false }, { text: 'HELLO', match: true }]);
    expect(matchSlices('İstanbul', 'i')).toEqual([{ text: 'İstanbul', match: false }]);
  });
});
