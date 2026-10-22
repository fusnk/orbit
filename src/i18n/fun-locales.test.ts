import { describe, expect, it } from 'vitest';
import { en } from './locales/en';
import { BRANDS, FUN_LANGUAGES, funText, isFunLanguage, segments } from './fun-locales';
import { isLanguageChoice } from './index';

const placeholders = (text: string) => [...text.matchAll(/\{[^}]*\}/g)].map((m) => m[0]).sort();
const strings = Object.entries(en as Record<string, string>);

describe('fun languages', () => {
  for (const { id } of FUN_LANGUAGES) {
    const made = strings.map(([key, text]) => [key, text, funText(id, key, text)] as const);

    it(`${id} keeps every placeholder`, () => {
      expect(made.filter(([, text, fun]) => placeholders(fun).join() !== placeholders(text).join()).map(([key]) => key)).toEqual([]);
    });

    it(`${id} has no empty strings`, () => {
      expect(made.filter(([, , fun]) => !fun.trim()).map(([key]) => key)).toEqual([]);
    });

    it(`${id} makes the same string for a key every time`, () => {
      expect(made.filter(([key, text, fun]) => funText(id, key, text) !== fun).map(([key]) => key)).toEqual([]);
    });

    it(`${id} keeps brand names`, () => {
      const lost = made.filter(([, text, fun]) => BRANDS.some((brand) => new RegExp(`(?<![\\w-])${brand}(?![\\w-])`).test(text) && !fun.includes(brand)));
      expect(lost.map(([key]) => key)).toEqual([]);
    });

    it(`${id} keeps tags, links and key names`, () => {
      const text = 'Press Ctrl+K or Esc, then <b>open</b> https://example.com/path or a stremio:// link for {name}.';
      const fun = funText(id, 'test.key', text);
      for (const part of ['Ctrl+K', 'Esc', '<b>', '</b>', 'https://example.com/path', 'stremio://', '{name}']) expect(fun).toContain(part);
    });
  }

  it('keeps the names of keys in English', () => {
    for (const { id } of FUN_LANGUAGES) expect(funText(id, 'settings.keys.space', 'Space')).toBe('Space');
  });

  it('pirate speaks like a pirate', () => {
    expect(funText('x-pirate', 'a.b', 'Are you sure? Your library is loading')).toBe('Be ye sure? Yer treasure hold be loadin’');
  });

  it('uwu turns r and l into w', () => {
    expect(funText('x-uwu', 'a.b', 'Really')).toMatch(/^(W-)?Weawwy/);
  });

  it('futhark writes runes and keeps digits', () => {
    expect(funText('x-futhark', 'a.b', 'Season 2 of the thing')).toBe('ᛊᛖᚨᛊᛟᚾ 2 ᛟᚠ ᚦᛖ ᚦᛁᛜ');
  });

  it('upside down flips and reverses, keeping placeholders whole', () => {
    expect(funText('x-upside-down', 'a.b', 'Hi {name}!')).toBe('¡{name} ᴉH');
  });

  it('splits frozen parts from prose', () => {
    expect(segments('Open Plex in {app}').map((s) => [s.text, s.frozen])).toEqual([
      ['Open ', false],
      ['Plex', true],
      [' in ', false],
      ['{app}', true],
    ]);
  });

  it('a saved joke language counts only while Fun languages is on', () => {
    expect(isLanguageChoice('x-uwu')).toBe(false);
    expect(isLanguageChoice('x-uwu', true)).toBe(true);
    expect(isLanguageChoice('fr')).toBe(true);
    expect(isLanguageChoice('x-nope', true)).toBe(false);
  });

  it('knows its ids', () => {
    expect(isFunLanguage('x-pirate')).toBe(true);
    expect(isFunLanguage('en')).toBe(false);
  });
});
