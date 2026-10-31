import { describe, expect, it } from 'vitest';
import { LANGUAGE_CHOICES } from '../rooms/player/preferred-language';
import { flagFor } from './language-flags';

describe('flagFor', () => {
  it('reads the codes files and addons send', () => {
    expect(flagFor('eng')).toBe('us');
    expect(flagFor('fre')).toBe('fr');
    expect(flagFor('ger')).toBe('de');
    expect(flagFor('jpn')).toBe('jp');
    expect(flagFor('English')).toBe('us');
  });

  it('follows a region or script the tag names', () => {
    expect(flagFor('pt-BR')).toBe('br');
    expect(flagFor('pob')).toBe('br');
    expect(flagFor('pt')).toBe('pt');
    expect(flagFor('es-419')).toBe('mx');
    expect(flagFor('es')).toBe('es');
    expect(flagFor('zh-Hant')).toBe('tw');
    expect(flagFor('zht')).toBe('tw');
    expect(flagFor('zh-HK')).toBe('hk');
    expect(flagFor('chi')).toBe('cn');
    expect(flagFor('en-GB')).toBe('gb');
    expect(flagFor('fr-CA')).toBe('ca');
    expect(flagFor('nob')).toBe('no');
  });

  it("falls back to the language's flag for a region with none bundled", () => {
    expect(flagFor('en-ZZ')).toBe('us');
    expect(flagFor('fr-CA', (flag) => flag !== 'ca')).toBe('fr');
  });

  it('gives none for unknown languages and ones no country stands for', () => {
    expect(flagFor(null)).toBeNull();
    expect(flagFor('')).toBeNull();
    expect(flagFor('und')).toBeNull();
    expect(flagFor('eo')).toBeNull();
    expect(flagFor('la')).toBeNull();
    expect(flagFor('not a code')).toBeNull();
  });

  it('has a bundled flag for every language the settings offer', () => {
    expect(LANGUAGE_CHOICES.filter((code) => !flagFor(code))).toEqual([]);
  });
});

