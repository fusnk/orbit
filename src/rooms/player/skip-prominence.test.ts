import { describe, expect, it } from 'vitest';
import { LOUD_BEFORE_END, QUIET_FOR, skipProminence } from './skip';

describe('skipProminence', () => {
  it('starts quiet and turns prominent after a few seconds', () => {
    expect(skipProminence(100, 100, 190, false)).toBe('subtle');
    expect(skipProminence(100, 100 + QUIET_FOR - 0.5, 190, false)).toBe('subtle');
    expect(skipProminence(100, 100 + QUIET_FOR, 190, false)).toBe('prominent');
  });

  it('is prominent near the end whenever it appeared', () => {
    expect(skipProminence(100, 101, 100 + LOUD_BEFORE_END + 1, false)).toBe('prominent');
  });

  it('counts a seek back as having been seen', () => {
    expect(skipProminence(100, 90, 190, false)).toBe('prominent');
  });

  it('is prominent from the start with reduced motion', () => {
    expect(skipProminence(100, 100, 190, true)).toBe('prominent');
  });
});
