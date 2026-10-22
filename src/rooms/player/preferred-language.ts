/**
 * Settings → Audio & Subtitles: the audio language and the subtitle
 * languages to pick automatically. mpv chooses among the file's own tracks
 * (by `alang` and `slang`); if the file has no subtitles in the first
 * subtitle language, the player loads one from a subtitle addon, else tries
 * the next language, in the person's order.
 */
import { languageName } from '../../lib/languages';

export const LANGUAGE_SETTINGS = {
  audio: 'player.audio-language',
  subtitle: 'player.subtitle-language',
  /** True: when the audio is already in the subtitle language, only forced subtitles (default false). */
  forcedOnly: 'player.subtitle-forced-only',
  /** True: audio in the title's original language (from TMDB) first, then the audio language (default false). */
  originalAudio: 'player.audio-original',
} as const;

/** Languages offered, with the codes files tag them with (ISO 639-1, then 639-2/B and /T). */
const CODES: Record<string, string> = {
  en: 'en,eng',
  es: 'es,spa',
  fr: 'fr,fre,fra',
  de: 'de,ger,deu',
  it: 'it,ita',
  pt: 'pt,por',
  // Addons (OpenSubtitles) name Brazilian Portuguese "pob" and Traditional Chinese "zht" (lib/languages.ts
  // reads both as these keys); files may only say Portuguese or Chinese, so those come last for mpv.
  // Regional tags are lowercase: mpv matches them case-insensitively and Rust accepts only lowercase.
  'pt-BR': 'pt-br,pob,pb,pt,por',
  'zh-Hant': 'zh-hant,zh-tw,zh-hk,zht,zh,chi,zho',
  nl: 'nl,dut,nld',
  sv: 'sv,swe',
  da: 'da,dan',
  no: 'no,nor,nob',
  fi: 'fi,fin',
  pl: 'pl,pol',
  cs: 'cs,cze,ces',
  hu: 'hu,hun',
  ro: 'ro,rum,ron',
  el: 'el,gre,ell',
  ru: 'ru,rus',
  uk: 'uk,ukr',
  tr: 'tr,tur',
  ar: 'ar,ara',
  he: 'he,heb',
  hi: 'hi,hin',
  th: 'th,tha',
  vi: 'vi,vie',
  id: 'id,ind',
  ja: 'ja,jpn',
  ko: 'ko,kor',
  zh: 'zh,chi,zho',
};

/** Language keys for the settings menus, sorted by name. */
export const LANGUAGE_CHOICES = Object.keys(CODES).sort((a, b) => languageName(a).localeCompare(languageName(b)));

/** Subtitle languages a person can line up. */
const MAX_LANGUAGES = 5;

const isKey = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(CODES, value);

/**
 * Saved language keys in order: a list (the subtitle languages), or one key
 * as older Orbit saved it. Unknown keys and repeats are dropped.
 */
export function parseLanguages(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.filter(isKey))].slice(0, MAX_LANGUAGES);
}

/**
 * The audio language: English until one is chosen, as source ranking assumes (ranking-prefs.ts).
 * Without one mpv played the file's default track, which in multi-language releases is often another
 * language's. '' (chosen in Settings as "The video's default") still leaves it to the file.
 */
export function parseAudioLanguage(value: unknown): string {
  return value === null || value === undefined ? 'en' : parseLanguage(value);
}

/** The first saved language key, or '' (the file's default, or no automatic subtitles). */
export function parseLanguage(value: unknown): string {
  return parseLanguages(value)[0] ?? '';
}

/** What mpv's `alang`/`slang` get for a key or keys in order; '' leaves the choice to the file. */
export const mpvLanguages = (keys: string | readonly string[]): string => [...new Set(parseLanguages(keys).flatMap((key) => CODES[key]!.split(',')))].join(',');

/** The language key a track's code belongs to ("eng" → "en", "pob" → "pt-BR"), or null for one Orbit doesn't list. */
export function keyForCode(code: string | null | undefined): string | null {
  const raw = code?.trim().toLowerCase();
  if (!raw) return null;
  // Most specific first, so "pt-br" is Brazilian rather than plain Portuguese.
  const keys = Object.keys(CODES).sort((a, b) => CODES[a]!.split(',').length - CODES[b]!.split(',').length);
  return keys.find((key) => key.toLowerCase() === raw) ?? keys.find((key) => CODES[key]!.split(',').includes(raw)) ?? null;
}

/**
 * The language to load addon subtitles in: the first preferred one that the
 * file or an addon has subtitles in (`has`), else the first. '' with none.
 */
export function availableLanguage(languages: readonly string[], has: (language: string) => boolean): string {
  return languages.find(has) ?? languages[0] ?? '';
}

/**
 * Whether mpv's languages are set again for the file about to open: another
 * device sent the ones it played with (`sentNow`), or another title starts
 * (`newTitle`) and either it has its own original language (`original`) or
 * the languages in place were another device's (`sentBefore`), which are for
 * the title continued from it and its episodes, not whatever plays next.
 */
export function languagesChange(change: { newTitle: boolean; original: boolean; sentBefore: boolean; sentNow: boolean }): boolean {
  return change.sentNow || (change.newTitle && (change.original || change.sentBefore));
}

/** TMDB's original-language codes that aren't ISO 639-1: "cn" is Cantonese, which files tag "yue" or as Chinese. */
const TMDB_CODES: Record<string, string> = { cn: 'yue,zh,chi,zho' };

/**
 * mpv's `alang` with "Original language first" on: the codes for `original`
 * (TMDB's code for the language a title was made in), then the chosen audio
 * language's; a code Orbit doesn't list goes as it is. TMDB's "xx" (no
 * language) and anything that isn't a plain code count as unknown.
 */
export function audioLanguages(original: string | null | undefined, chosen: string): string {
  const own = typeof original === 'string' && /^[a-z]{2,3}$/.test(original) && original !== 'xx' ? (TMDB_CODES[original] ?? (Object.hasOwn(CODES, original) ? CODES[original]! : original)).split(',') : [];
  return [...new Set([...own, ...mpvLanguages(chosen).split(',').filter(Boolean)])].join(',');
}
