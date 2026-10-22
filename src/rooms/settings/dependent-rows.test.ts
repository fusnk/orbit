import { describe, expect, it } from 'vitest';
import { ambientFollowUpsShown, autoplayFollowUpsShown, countdownRowsShown, resumeSourceShown, spoilerScopeShown, trailerFollowUpsShown } from './dependent-rows';

const noSpoilers = { titles: false, descriptions: false, thumbnails: false, ratings: false, unaired: false };

describe('dependent rows', () => {
  it("shows the Next Up card's rows unless autoplay is Never", () => {
    expect(autoplayFollowUpsShown('always')).toBe(true);
    expect(autoplayFollowUpsShown('ask')).toBe(true);
    expect(autoplayFollowUpsShown('never')).toBe(false);
  });

  it('shows the autoplay limit and countdown only when autoplay is Always (Ask never plays on its own)', () => {
    expect(countdownRowsShown('always')).toBe(true);
    expect(countdownRowsShown('ask')).toBe(false);
    expect(countdownRowsShown('never')).toBe(false);
  });

  it('asks which source to resume with unless resuming starts over', () => {
    expect(resumeSourceShown('always')).toBe(true);
    expect(resumeSourceShown('ask')).toBe(true);
    // Nothing saved yet means the default, Always.
    expect(resumeSourceShown(undefined)).toBe(true);
    expect(resumeSourceShown('start-over')).toBe(false);
  });

  it('shows trailer delay and sound while trailers play anywhere', () => {
    expect(trailerFollowUpsShown(false, false)).toBe(false);
    expect(trailerFollowUpsShown(true, false)).toBe(true);
    expect(trailerFollowUpsShown(false, true)).toBe(true);
    expect(trailerFollowUpsShown(true, true)).toBe(true);
  });

  it('shows what spoiler hiding applies to once anything is hidden', () => {
    expect(spoilerScopeShown(noSpoilers)).toBe(false);
    for (const key of Object.keys(noSpoilers) as (keyof typeof noSpoilers)[]) expect(spoilerScopeShown({ ...noSpoilers, [key]: true })).toBe(true);
  });

  it('shows ambient mode’s options only when it starts at all', () => {
    expect(ambientFollowUpsShown({ afterMinutes: 0 })).toBe(false);
    expect(ambientFollowUpsShown({ afterMinutes: 10 })).toBe(true);
  });
});
