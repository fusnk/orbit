import { describe, expect, it } from 'vitest';
import { agoText } from './ago';

const now = Date.UTC(2026, 9, 4, 12, 0, 0);
const minutes = (n: number) => now - n * 60_000;

describe('agoText', () => {
  it('leaves under a minute to the caller', () => {
    expect(agoText(now, now, 'en-US')).toBeNull();
    expect(agoText(now - 20_000, now, 'en-US')).toBeNull();
    // A clock that moved back counts as just now, not "in 3 minutes".
    expect(agoText(now + 3 * 60_000, now, 'en-US')).toBeNull();
  });

  it('counts minutes, then hours, then days', () => {
    expect(agoText(minutes(1), now, 'en-US')).toBe('1 minute ago');
    expect(agoText(minutes(59), now, 'en-US')).toBe('59 minutes ago');
    expect(agoText(minutes(60), now, 'en-US')).toBe('1 hour ago');
    expect(agoText(minutes(47 * 60), now, 'en-US')).toBe('47 hours ago');
    expect(agoText(minutes(48 * 60), now, 'en-US')).toBe('2 days ago');
  });

  it('speaks the interface language', () => {
    expect(agoText(minutes(5), now, 'fr-FR')).toBe('il y a 5 minutes');
    expect(agoText(minutes(3 * 60), now, 'de-DE')).toBe('vor 3 Stunden');
  });
});
