/**
 * Language codes from video files and subtitle addons, as names people read.
 * Files use ISO 639-2 ("eng", "fre"); addons mostly do too, plus a few
 * OpenSubtitles codes of their own. Everything is grouped by one canonical
 * code so "eng", "en" and "English" land in the same group.
 */
import { locale, t } from '../i18n';

/** OpenSubtitles' own codes, and plain names some addons send. */
const ALIASES: Record<string, string> = {
  pob: 'pt-BR',
  pb: 'pt-BR',
  zht: 'zh-Hant',
  zhs: 'zh-Hans',
  zhe: 'zh',
  ze: 'zh',
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
};

export const UNKNOWN_LANGUAGE = 'und';

const names = new Intl.DisplayNames([locale()], { type: 'language' });

/** A canonical code for grouping ("eng" → "en"), or "und" when unknown. */
export function languageKey(code: string | null | undefined): string {
  const raw = code?.trim().toLowerCase();
  if (!raw) return UNKNOWN_LANGUAGE;
  const aliased = ALIASES[raw] ?? raw;
  try {
    return Intl.getCanonicalLocales(aliased)[0] ?? UNKNOWN_LANGUAGE;
  } catch {
    return UNKNOWN_LANGUAGE;
  }
}

/** "English", "Brazilian Portuguese"; "Unknown" when there's no usable code. */
export function languageName(key: string): string {
  if (key === UNKNOWN_LANGUAGE) return t('browse.languages.unknown');
  let name: string | undefined;
  try {
    name = names.of(key);
  } catch {
    // Not a valid tag; fall through to the code itself.
  }
  // DisplayNames echoes codes it doesn't know; show those in capitals.
  return name && name.toLowerCase() !== key.toLowerCase() ? name : key.toUpperCase();
}
