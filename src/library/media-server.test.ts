import { describe, expect, it } from 'vitest';
import { resumeFrom } from './media-server';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-15T20:00:00Z');

describe('where to resume a video from the person’s own server', () => {
  it('takes the server’s place when it was watched there (another app) after Orbit', () => {
    expect(resumeFrom({ position: 600, updatedAt: NOW - 2 * HOUR }, { resume: 2400, resumeAt: NOW - HOUR })).toBe(2400);
    // Finished here long ago, started again on the TV since.
    expect(resumeFrom({ position: 0, updatedAt: NOW - 2 * HOUR }, { resume: 900, resumeAt: NOW - HOUR })).toBe(900);
  });

  it('keeps Orbit’s place when Orbit watched it later, or the server can’t say when', () => {
    expect(resumeFrom({ position: 600, updatedAt: NOW - HOUR }, { resume: 2400, resumeAt: NOW - 2 * HOUR })).toBe(600);
    expect(resumeFrom({ position: 600, updatedAt: NOW - HOUR }, { resume: 2400 })).toBe(600);
    // Orbit's own report moves the server's time too, a moment after Orbit's history: that's no later watch.
    expect(resumeFrom({ position: 600, updatedAt: NOW }, { resume: 600, resumeAt: NOW + 5000 })).toBe(600);
  });

  it('starts over when Orbit finished it or marked it unwatched after the server’s place was set', () => {
    // Watched to Orbit's threshold, short of the server's: the server still holds a place, set by Orbit's own report.
    expect(resumeFrom({ position: 0, updatedAt: NOW }, { resume: 2400, resumeAt: NOW - 30_000 })).toBe(0);
    expect(resumeFrom({ position: 0, updatedAt: NOW - HOUR }, { resume: 2400, resumeAt: NOW - 2 * HOUR })).toBe(0);
  });

  it('with nothing in Orbit’s history, the server’s place', () => {
    expect(resumeFrom({ position: 0 }, { resume: 2400, resumeAt: NOW })).toBe(2400);
    expect(resumeFrom({ position: 0 }, { resume: 2400 })).toBe(2400);
    expect(resumeFrom({ position: 0 }, {})).toBe(0);
  });
});
