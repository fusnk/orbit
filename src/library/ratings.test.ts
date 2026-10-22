import { describe, expect, it, vi } from 'vitest';

const rows = new Map<string, { titleId: string; rating: number | null; liked: boolean; note: string | null; updatedAt: number }>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: { titleId: string; rating: number | null; liked: boolean; note: string | null }) => {
    // A round trip, so a second change can start before the first is saved.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (command === 'rating_set') rows.set(args.titleId, { ...args, updatedAt: 1 });
    return command === 'rating_all' ? [...rows.values()] : undefined;
  },
}));

import { clampRating, cleanNote, noteLength, ratingAt, setUserRating, starFill, userRating } from './ratings';

describe('own ratings', () => {
  it('keeps ratings to half steps from 0.5 to 5', () => {
    expect(clampRating(3.5)).toBe(3.5);
    expect(clampRating(3.7)).toBe(3.5);
    expect(clampRating(3.8)).toBe(4);
    expect(clampRating(9)).toBe(5);
    expect(clampRating(0.5)).toBe(0.5);
    expect(clampRating(0)).toBeNull();
    expect(clampRating(-2)).toBeNull();
    expect(clampRating(Number.NaN)).toBeNull();
  });

  it('picks the half star under the pointer', () => {
    expect(ratingAt(0)).toBe(0.5);
    expect(ratingAt(0.05)).toBe(0.5);
    expect(ratingAt(0.11)).toBe(1);
    expect(ratingAt(0.65)).toBe(3.5);
    expect(ratingAt(1)).toBe(5);
    expect(ratingAt(1.4)).toBe(5);
  });

  it('fills stars from the start', () => {
    expect([0, 1, 2, 3, 4].map((i) => starFill(3.5, i))).toEqual(['full', 'full', 'full', 'half', 'empty']);
    expect([0, 1, 2, 3, 4].map((i) => starFill(null, i))).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(starFill(5, 4)).toBe('full');
  });

  it('saves notes trimmed, and empty ones as none', () => {
    expect(cleanNote('  Watch with Sam \n')).toBe('Watch with Sam');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(null)).toBeNull();
    // Counted as Rust counts: an emoji is one character.
    expect(noteLength('🎬ab')).toBe(3);
  });

  it('keeps every change when several are made within one round trip', async () => {
    await Promise.all([setUserRating('tt1', { rating: 4 }), setUserRating('tt1', { liked: true }), setUserRating('tt1', { note: ' Again ' })]);
    expect(rows.get('tt1')).toMatchObject({ rating: 4, liked: true, note: 'Again' });
    expect(userRating('tt1')).toMatchObject({ rating: 4, liked: true, note: 'Again' });
  });
});
