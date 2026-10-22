/**
 * Orbit's interface in the person's language (Settings → General → Language).
 *
 * Every user-facing string is looked up by key with `t('area.key')`, from one
 * catalog per area per language (src/i18n/locales/<lang>/<area>.ts). English
 * is complete and is the fallback for anything a translation lacks. Strings
 * may hold `{name}` placeholders; counted strings have `.one` / `.other`
 * forms, picked with `tn()` by the language's plural rules.
 *
 * The choice is needed before any page draws (some formatters are built when
 * their module loads), so it's mirrored in localStorage and read at once;
 * the saved setting stays the source of truth (`syncLanguage`), and changing
 * it reloads the window.
 *
 * With Fun languages on (Settings → Appearance), joke languages made from the
 * English strings (fun-locales.ts) can be picked too. They change only the
 * words: dates, numbers, TMDB and layout stay English.
 */
import { FUN_KEY, parseFun } from '../lib/fun';
import { settings } from '../lib/ipc';
import { FUN_LANGUAGES, funText, isFunLanguage, type FunLanguageId } from './fun-locales';
import { en, type MessageKey } from './locales/en';

export type { MessageKey };
export { FUN_LANGUAGES, isFunLanguage, type FunLanguageId };

export const LANGUAGES = [
  { id: 'en', name: 'English', tag: 'en-US' },
  { id: 'es', name: 'Español', tag: 'es-ES' },
  { id: 'fr', name: 'Français', tag: 'fr-FR' },
  { id: 'pt', name: 'Português', tag: 'pt-BR' },
  { id: 'de', name: 'Deutsch', tag: 'de-DE' },
  { id: 'it', name: 'Italiano', tag: 'it-IT' },
  { id: 'nl', name: 'Nederlands', tag: 'nl-NL' },
  { id: 'pl', name: 'Polski', tag: 'pl-PL' },
  { id: 'cs', name: 'Čeština', tag: 'cs-CZ' },
  { id: 'sv', name: 'Svenska', tag: 'sv-SE' },
  { id: 'id', name: 'Bahasa Indonesia', tag: 'id-ID' },
  { id: 'ja', name: '日本語', tag: 'ja-JP' },
  { id: 'ko', name: '한국어', tag: 'ko-KR' },
  { id: 'ru', name: 'Русский', tag: 'ru-RU' },
  { id: 'uk', name: 'Українська', tag: 'uk-UA' },
  { id: 'tr', name: 'Türkçe', tag: 'tr-TR' },
  { id: 'zh', name: '简体中文', tag: 'zh-CN' },
  // Western digits, as most Arabic streaming apps use; TMDB wants a region.
  { id: 'ar', name: 'العربية', tag: 'ar-u-nu-latn', tmdb: 'ar-SA', rtl: true },
  { id: 'he', name: 'עברית', tag: 'he-IL', rtl: true },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];
/** What the setting holds: a language, a joke language, or 'system' to follow Windows. */
export type LanguageChoice = LanguageId | FunLanguageId | 'system';

/** Keys are English's, plus extra plural forms some languages have (see `tn`). */
type Strings = Partial<Record<string, string>>;

/**
 * Every language but English is its own chunk, loaded when it's needed: the
 * catalogs together are most of the app's JavaScript (megabytes), and parsing
 * all of them held up every start for one language's strings.
 */
const LOADERS: Record<Exclude<LanguageId, 'en'>, () => Promise<Strings>> = {
  es: () => import('./locales/es').then((m) => m.es),
  fr: () => import('./locales/fr').then((m) => m.fr),
  pt: () => import('./locales/pt').then((m) => m.pt),
  de: () => import('./locales/de').then((m) => m.de),
  it: () => import('./locales/it').then((m) => m.it),
  nl: () => import('./locales/nl').then((m) => m.nl),
  pl: () => import('./locales/pl').then((m) => m.pl),
  cs: () => import('./locales/cs').then((m) => m.cs),
  sv: () => import('./locales/sv').then((m) => m.sv),
  id: () => import('./locales/id').then((m) => m.id),
  ja: () => import('./locales/ja').then((m) => m.ja),
  ko: () => import('./locales/ko').then((m) => m.ko),
  ru: () => import('./locales/ru').then((m) => m.ru),
  uk: () => import('./locales/uk').then((m) => m.uk),
  tr: () => import('./locales/tr').then((m) => m.tr),
  zh: () => import('./locales/zh').then((m) => m.zh),
  ar: () => import('./locales/ar').then((m) => m.ar),
  he: () => import('./locales/he').then((m) => m.he),
};
/** The catalogs loaded so far; a language not loaded (yet) reads as English. */
const CATALOGS: Partial<Record<LanguageId, Strings>> = { en };

/** Loads `id`'s catalog once; if it can't be loaded, that language reads as English. */
export async function loadLanguage(id: LanguageId): Promise<void> {
  if (CATALOGS[id]) return;
  try {
    CATALOGS[id] = await LOADERS[id as Exclude<LanguageId, 'en'>]();
  } catch (err) {
    console.warn(`Could not load the ${id} strings`, err);
  }
}

/** Every language's catalog, for reading text typed in any of them (Search, `everyTranslation`). */
export const loadEveryCatalog = (): Promise<void> => Promise.all(LANGUAGES.map((l) => loadLanguage(l.id))).then(() => {});
/** Whether `everyTranslation` covers every language yet. */
export const everyCatalogLoaded = (): boolean => LANGUAGES.every((l) => CATALOGS[l.id]);

export const LANGUAGE_KEY = 'general.language';
/** sessionStorage: where to reopen after the window restarts in a new language. */
export const RETURN_TO_KEY = 'orbit.return-to';
const MIRROR_KEY = 'orbit.language';

/** A joke language counts only while Fun languages is on. */
export const isLanguageChoice = (v: unknown, funLanguages = false): v is LanguageChoice => v === 'system' || LANGUAGES.some((l) => l.id === v) || (funLanguages && isFunLanguage(v));

/** The system's preferred languages, most preferred first (Windows' display language, then the others set there). */
function systemTags(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/**
 * The language 'system' means: the first of the system's preferred languages
 * Orbit has (so "Swiss German, then French" picks German, and "Ukrainian,
 * then Polish" Polish), else English.
 */
export function pickSystemLanguage(tags: readonly string[]): LanguageId {
  for (const tag of tags) {
    const found = LANGUAGES.find((l) => l.id === languageOf(tag));
    if (found) return found.id;
  }
  return 'en';
}

/** A tag's language code ("kok" for Konkani, not "ko"), or null for a malformed tag. */
function languageOf(tag: string): string | null {
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return null;
  }
}
export const systemLanguage = (): LanguageId => pickSystemLanguage(systemTags());

/** Languages whose dates and times follow the system's region when it's one of theirs (en-GB, en-AU, pt-PT…). */
const REGIONAL = new Set<LanguageId>(['en', 'pt']);

/**
 * The tag for dates and times: the language's own (e.g. "en-US"), or for
 * English and Portuguese the system's regional one when it's that language
 * ("en-GB" writes 14/10/2026 and 21:30). Only a well-formed tag counts.
 */
export function regionalTag(language: LanguageId, tags: readonly string[]): string | null {
  if (!REGIONAL.has(language)) return null;
  for (const tag of tags) {
    const match = /^([a-z]{2})-([a-z]{2})$/i.exec(tag);
    if (!match || match[1]!.toLowerCase() !== language) continue;
    try {
      return Intl.getCanonicalLocales(`${language}-${match[2]!.toUpperCase()}`)[0] ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function readMirror(): LanguageChoice {
  try {
    const saved = localStorage.getItem(MIRROR_KEY);
    // A joke language is only mirrored while it was allowed; `syncLanguage` checks the switch.
    return isLanguageChoice(saved, true) ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** The real language a choice draws in: a joke language uses English's formats and plural rules. */
const baseLanguage = (next: LanguageChoice): LanguageId => (next === 'system' ? systemLanguage() : isFunLanguage(next) ? 'en' : next);

let choice: LanguageChoice = readMirror();
let current: LanguageId = baseLanguage(choice);
let fun: FunLanguageId | null = isFunLanguage(choice) ? choice : null;
/** The joke language's strings, made as each is first shown. */
let funStrings = new Map<string, string>();
let plurals = new Intl.PluralRules(LANGUAGES.find((l) => l.id === current)!.tag);
let regional = regionalTag(current, systemTags());

export const languageChoice = () => choice;
/** The language being drawn in ('en' for a joke language). */
export const language = () => current;
/** The BCP 47 tag for dates and numbers, e.g. "fr-FR", or the system's own region for English and Portuguese ("en-GB"). */
export const locale = (): string => regional ?? LANGUAGES.find((l) => l.id === current)!.tag;
/** The tag TMDB wants (it needs a region, e.g. "ar-SA"). */
export function tmdbLanguage(): string {
  const entry = LANGUAGES.find((l) => l.id === current)!;
  return 'tmdb' in entry ? entry.tmdb : entry.tag;
}
/** Whether the language reads right to left (the whole layout mirrors). */
export const isRtl = () => LANGUAGES.some((l) => l.id === current && 'rtl' in l && l.rtl);

/** `lang` and `dir` on <html>: the browser mirrors the layout from `dir`. */
function markDocument(): void {
  // (Tests run without a page.)
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
}
markDocument();
// Before any module that uses `t` runs (some build their text as they load): this waits for the
// language's own catalog, one small chunk, instead of every language being in the main bundle.
await loadLanguage(current);

/** Whether `key` is one of Orbit's strings (for keys made at run time, e.g. from an error code). */
export const hasMessage = (key: string): key is MessageKey => Object.hasOwn(en, key);

/** `key` in the current language (English if missing), with `{name}` placeholders filled. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = fun ? funString(fun, key) : (CATALOGS[current]?.[key] ?? (en as Record<string, string>)[key] ?? key);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? formatVar(vars[name]!, name) : whole));
}

function funString(id: FunLanguageId, key: string): string {
  let text = funStrings.get(key);
  if (text === undefined) {
    const english = (en as Record<string, string>)[key];
    text = english === undefined ? key : funText(id, key, english);
    funStrings.set(key, text);
  }
  return text;
}

/** `key` in every language Orbit has loaded (all of them after `loadEveryCatalog`), e.g. to read a search typed in any of them. */
export const everyTranslation = (key: MessageKey): string[] => LANGUAGES.map((l) => CATALOGS[l.id]?.[key] ?? (en as Record<string, string>)[key] ?? key);

/** Placeholders that name a thing rather than count: a year, an id, a season or episode number ("S1 · E1100", not "E1,100"). */
const LABEL_NUMBERS = new Set(['id', 'year', 'season', 'episode', 'number']);

/**
 * A number format for the current language, made once per language and options. `toLocaleString` builds a
 * new formatter on every call: thousands of them for a Home of rating labels, about 60 ms of a TV box's time.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(name: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale()}|${name}`;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, (format = new Intl.NumberFormat(locale(), options)));
  return format;
}

const formatVar = (v: string | number, name: string) => (typeof v === 'number' ? (LABEL_NUMBERS.has(name) ? numberFormat('label', { useGrouping: false }) : numberFormat('plain')).format(v) : v);

/** A number with one decimal as the language writes it (ratings: "7.1", "7,1"). */
export const formatDecimal = (value: number): string => numberFormat('decimal', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

/** Names as a list the language writes it: "Drama, Crime" in English, "Drama et Crime" in French. */
export const formatList = (items: readonly string[]): string => listFormat().format(items);

let listFormatFor: { tag: string; format: Intl.ListFormat } | undefined;
/** Short unit lists, except where they're joined by a space or nothing (Russian, Japanese, Chinese…): then the language's "and" list, so names don't run together. */
function listFormat(): Intl.ListFormat {
  const tag = locale();
  if (listFormatFor?.tag !== tag) {
    const unit = new Intl.ListFormat(tag, { type: 'unit', style: 'short' });
    const format = /^a\s?b$/.test(unit.format(['a', 'b'])) ? new Intl.ListFormat(tag, { type: 'conjunction', style: 'short' }) : unit;
    listFormatFor = { tag, format };
  }
  return listFormatFor.format;
}

/**
 * A counted string by the language's plural rules, with `{count}` filled:
 * `base.one`, `base.other`, and in languages that have them `base.zero`,
 * `.two`, `.few` and `.many` (Polish, Czech, Russian, Ukrainian, Arabic). A form a catalog lacks falls
 * back to `.other`.
 */
export function tn(base: string, count: number, vars?: Record<string, string | number>): string {
  const form = `${base}.${plurals.select(count)}`;
  const key = (CATALOGS[current]?.[form] !== undefined || form in en ? form : `${base}.other`) as MessageKey;
  return t(key, { count, ...vars });
}

function apply(next: LanguageChoice): void {
  choice = next;
  current = baseLanguage(next);
  fun = isFunLanguage(next) ? next : null;
  funStrings = new Map();
  regional = regionalTag(current, systemTags());
  plurals = new Intl.PluralRules(locale());
  markDocument();
}

/**
 * Checks the saved setting against the mirror read at startup (they differ
 * after restoring a backup); reloads once if the language should change.
 */
export async function syncLanguage(): Promise<void> {
  const [saved, funPrefs] = await Promise.all([settings.get(LANGUAGE_KEY).catch(() => null), settings.get(FUN_KEY).catch(() => null)]);
  // A joke language saved while Fun languages was on falls back to the system language once it's off.
  const next = isLanguageChoice(saved, parseFun(funPrefs).languages) ? saved : 'system';
  if (next === choice) return;
  writeMirror(next);
  const before = current;
  const beforeFun = fun;
  apply(next);
  if (current !== before || fun !== beforeFun) location.reload();
}

function writeMirror(next: LanguageChoice): void {
  try {
    localStorage.setItem(MIRROR_KEY, next);
  } catch {
    // Without storage the setting still applies; it's just read a moment later.
  }
}

/** Saves a new language; the caller reloads the window to redraw in it. */
export async function setLanguage(next: LanguageChoice): Promise<void> {
  await settings.set(LANGUAGE_KEY, next);
  writeMirror(next);
  await loadLanguage(baseLanguage(next));
  apply(next);
}
