import { describe, expect, it } from 'vitest';
import { languageKey, languageName, UNKNOWN_LANGUAGE } from './languages';

describe('languageKey', () => {
  it('groups the different spellings of a language', () => {
    expect(new Set(['eng', 'en', 'EN', ' English '].map(languageKey))).toEqual(new Set(['en']));
    expect(languageKey('fre')).toBe(languageKey('fra'));
  });

  it('maps OpenSubtitles codes', () => {
    expect(languageKey('pob')).toBe('pt-BR');
  });

  it.each([undefined, null, '', '   ', '!!'])('treats %s as unknown', (code) => {
    expect(languageKey(code)).toBe(UNKNOWN_LANGUAGE);
  });
});

describe('languageName', () => {
  it('names languages', () => {
    expect(languageName(languageKey('eng'))).toBe('English');
    expect(languageName(languageKey('ger'))).toBe('German');
    expect(languageName(languageKey('pob'))).toBe('Brazilian Portuguese');
    expect(languageName(UNKNOWN_LANGUAGE)).toBe('Unknown');
  });

  it('shows codes it cannot name in capitals', () => {
    expect(languageName(languageKey('xx'))).toBe('XX');
  });
});
