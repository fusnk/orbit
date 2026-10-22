import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({ settings: { get: vi.fn(), set: vi.fn() } }));

const { pickSystemLanguage, regionalTag } = await import('./index');

describe('pickSystemLanguage', () => {
  it('takes the first preferred language Orbit has', () => {
    expect(pickSystemLanguage(['de-CH', 'fr-FR'])).toBe('de');
    expect(pickSystemLanguage(['fi-FI', 'pl-PL', 'en-US'])).toBe('pl');
    expect(pickSystemLanguage(['uk-UA', 'ru-RU'])).toBe('uk');
    expect(pickSystemLanguage(['pt-PT'])).toBe('pt');
  });

  it('falls back to English', () => {
    expect(pickSystemLanguage(['fi-FI', 'hu'])).toBe('en');
    expect(pickSystemLanguage([])).toBe('en');
  });

  it('reads the whole language code, not its first two letters', () => {
    // Konkani, Kashubian and Mapudungun are not Korean, Czech and Arabic.
    expect(pickSystemLanguage(['kok-IN'])).toBe('en');
    expect(pickSystemLanguage(['csb-PL', 'de-DE'])).toBe('de');
    expect(pickSystemLanguage(['arn-CL'])).toBe('en');
    expect(pickSystemLanguage(['not a tag', 'ko-KR'])).toBe('ko');
  });
});

describe('regionalTag', () => {
  it('follows the region for English and Portuguese when the system has one of theirs', () => {
    expect(regionalTag('en', ['en-GB'])).toBe('en-GB');
    expect(regionalTag('en', ['fr-FR', 'en-au'])).toBe('en-AU');
    expect(regionalTag('pt', ['pt-PT'])).toBe('pt-PT');
  });

  it('keeps the language’s own tag otherwise', () => {
    expect(regionalTag('en', ['fr-FR'])).toBeNull();
    expect(regionalTag('en', ['en'])).toBeNull();
    expect(regionalTag('de', ['de-AT'])).toBeNull();
    expect(regionalTag('en', ['en-GB-oxendict', 'x-bad'])).toBeNull();
  });
});
