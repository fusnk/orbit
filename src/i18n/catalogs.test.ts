import { describe, expect, it } from 'vitest';
import { ar } from './locales/ar';
import { cs } from './locales/cs';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { he } from './locales/he';
import { it as italian } from './locales/it';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { nl } from './locales/nl';
import { pl } from './locales/pl';
import { pt } from './locales/pt';
import { sv } from './locales/sv';
import { id as indonesian } from './locales/id';
import { ru } from './locales/ru';
import { uk } from './locales/uk';
import { tr } from './locales/tr';
import { zh } from './locales/zh';

import { segments } from './fun-locales';
import { LANGUAGES } from './index';
import { PRESETS } from '../theme/palette';

const placeholders = (text: string) => [...text.matchAll(/\{[^}]*\}/g)].map((m) => m[0]).sort();

const TRANSLATIONS = { es, fr, pt, de, it: italian, nl, pl, cs, sv, id: indonesian, ja, ko, ru, uk, tr, zh, ar, he };

/** The bases of English's counted strings ("browse.hero.seasons" for 'browse.hero.seasons.one' / '.other'). */
const COUNTED = Object.keys(en)
  .filter((key) => key.endsWith('.other'))
  .map((key) => key.slice(0, -'.other'.length));

/** The plural forms a language's rules pick for 0–1000 (every form a count reaches; decimals aren't counted). */
function wholeNumberForms(tag: string): string[] {
  const rules = new Intl.PluralRules(tag);
  return [...new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)))];
}

/**
 * Forms that may be left to `.other`. Hebrew's dual ("two") belongs to a few nouns only (יומיים, שבועיים);
 * most write 2 like any plural ("2 פרקים"), so a catalog adds `.two` where the noun has one.
 */
const PLURAL_FALLBACK_OK: Partial<Record<string, string[]>> = { he: ['two'] };

/**
 * Words a translator would translate: what's left once names, codes, key names and placeholders are set
 * aside, without short ones ("min", "kb/s", "Up") that many languages share.
 */
const wordsToTranslate = (text: string) =>
  segments(text)
    .filter((s) => !s.frozen)
    .flatMap((s) => s.text.match(/\p{L}[\p{L}'’-]{3,}/gu) ?? []).length;

/** Kept in English everywhere: keyboard key names, award names, and the name TMDB gives its token on its own site. */
const ENGLISH_EVERYWHERE = /^settings\.keys\.|^explore\.award\.|^integrations\.tmdb\.field-/;

/** Strings the language really writes as English does (loanwords, a TMDB genre name, a feature named in English throughout). */
const KEPT_IN_ENGLISH: Partial<Record<string, string[]>> = {
  de: ['browse.genre.scifi', 'playerlook.end.trailer-in', 'studio.title'],
  it: ['player.controls.pip'],
  nl: ['settings.shortcuts.audio-later'],
  ru: ['studio.title'],
  uk: ['studio.title'],
};

describe('translations', () => {
  for (const [name, catalog] of Object.entries(TRANSLATIONS)) {
    it(`${name} fills the same placeholders as English, in every string`, () => {
      const wrong = Object.entries(en).filter(([key, text]) => {
        const translated = (catalog as Record<string, string>)[key];
        return translated === undefined || placeholders(translated).join() !== placeholders(text).join();
      });
      expect(wrong.map(([key]) => key)).toEqual([]);
    });

    it(`${name}'s extra keys are only plural forms of counted strings`, () => {
      const extra = Object.keys(catalog).filter((key) => !(key in en));
      const stray = extra.filter((key) => {
        const match = /^(.*)\.(zero|two|few|many)$/.exec(key);
        const other = match && (en as Record<string, string>)[`${match[1]}.other`];
        return !other || placeholders(catalog[key as keyof typeof catalog]).join() !== placeholders(other).join();
      });
      expect(stray).toEqual([]);
    });

    it(`${name} has no empty strings`, () => {
      expect(Object.entries(catalog).filter(([, text]) => !text.trim())).toEqual([]);
    });
  }

  for (const [name, catalog] of Object.entries(TRANSLATIONS)) {
    // `tn` picks a form with Intl.PluralRules; a form a catalog lacks falls back to `.other`, which reads wrong
    // in, say, Russian ("5 сезона"). Counts are whole numbers, so only the forms whole numbers reach matter.
    const used = wholeNumberForms(LANGUAGES.find((l) => l.id === name)!.tag);
    const needed = used.filter((form) => !PLURAL_FALLBACK_OK[name]?.includes(form));

    it(`${name} has every plural form its language uses (${needed.join(', ')}), and no others`, () => {
      const missing = COUNTED.flatMap((base) => needed.map((form) => `${base}.${form}`)).filter((key) => !(key in catalog));
      const unreachable = Object.keys(catalog).filter((key) => {
        const form = /\.(zero|two|few|many)$/.exec(key)?.[1];
        return form !== undefined && !used.includes(form);
      });
      expect({ missing, unreachable }).toEqual({ missing: [], unreachable: [] });
    });

    it(`${name} translates every sentence (no English left behind)`, () => {
      const english = Object.entries(en as Record<string, string>).filter(([key, text]) => (catalog as Record<string, string>)[key] === text && !ENGLISH_EVERYWHERE.test(key) && wordsToTranslate(text) >= 2);
      expect(english.map(([key]) => key).filter((key) => !KEPT_IN_ENGLISH[name]?.includes(key))).toEqual([]);
    });
  }

  // Theme names used to be hard-coded in English wherever themes are listed, so "Light" stayed "Light" in every language.
  it('name every built-in theme in every language', () => {
    const keys = PRESETS.map((preset) => (preset.id === 'crimson' ? 'settings.themes.crimson' : `settings.themes.name.${preset.id}`));
    for (const [name, catalog] of Object.entries({ en, ...TRANSLATIONS })) {
      const missing = keys.filter((key) => !(catalog as Record<string, string>)[key]?.trim());
      expect([name, missing]).toEqual([name, []]);
    }
    // Built in English (the tests' language), the presets carry the English names.
    expect(PRESETS.map((preset) => preset.name)).toEqual(keys.map((key) => (en as Record<string, string>)[key]));
    expect(PRESETS.map((preset) => preset.name)).toContain('Light');
  });

  // Save a card's key can be changed in Settings → Shortcuts, so the hint names no key of its own.
  it('the cards’ quick actions hint names no fixed key', () => {
    const naming = Object.entries({ en, ...TRANSLATIONS }).filter(([, catalog]) => /(^|[^\p{L}])L([^\p{L}]|$)/u.test(catalog['pages.cards.actions-hint']));
    expect(naming.map(([name]) => name)).toEqual([]);
  });

  it('counted strings come in pairs', () => {
    const keys = Object.keys(en);
    const unpaired = keys.filter((k) => (k.endsWith('.one') && !keys.includes(k.replace(/\.one$/, '.other'))) || (k.endsWith('.other') && !keys.includes(k.replace(/\.other$/, '.one'))));
    expect(unpaired).toEqual([]);
  });
});
