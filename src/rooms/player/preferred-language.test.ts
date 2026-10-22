import { describe, expect, it } from 'vitest';
import { keyForCode, languagesChange, parseAudioLanguage } from './preferred-language';

describe('languagesChange', () => {
  it('sets the languages again for what another device sent, and when a title leaves its own', () => {
    // Another device's languages, or a title of its own with "Original language first".
    expect(languagesChange({ newTitle: false, original: false, sentBefore: false, sentNow: true })).toBe(true);
    expect(languagesChange({ newTitle: true, original: true, sentBefore: false, sentNow: false })).toBe(true);
    // The next episode keeps them.
    expect(languagesChange({ newTitle: false, original: true, sentBefore: true, sentNow: false })).toBe(false);
    expect(languagesChange({ newTitle: true, original: false, sentBefore: false, sentNow: false })).toBe(false);
    // Another title after one continued from another device: back to this profile's own.
    expect(languagesChange({ newTitle: true, original: false, sentBefore: true, sentNow: false })).toBe(true);
  });
});

describe('keyForCode', () => {
  it('maps a track’s language code to the setting’s key', () => {
    expect(keyForCode('eng')).toBe('en');
    expect(keyForCode('EN')).toBe('en');
    expect(keyForCode('por')).toBe('pt');
    expect(keyForCode('pob')).toBe('pt-BR');
    expect(keyForCode('pt-br')).toBe('pt-BR');
    expect(keyForCode('chi')).toBe('zh');
    expect(keyForCode('zht')).toBe('zh-Hant');
  });

  it('knows nothing of codes Orbit doesn’t list', () => {
    expect(keyForCode('xyz')).toBeNull();
    expect(keyForCode('')).toBeNull();
    expect(keyForCode(null)).toBeNull();
  });
});

describe('parseAudioLanguage', () => {
  it('is English until a language is chosen, and keeps an explicit choice (including the video default)', () => {
    expect(parseAudioLanguage(null)).toBe('en');
    expect(parseAudioLanguage(undefined)).toBe('en');
    expect(parseAudioLanguage('')).toBe('');
    expect(parseAudioLanguage('fr')).toBe('fr');
  });
});
