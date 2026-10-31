/**
 * A country flag for a language, shown next to its name in the audio and
 * subtitle pickers and the language settings. A language isn't a country,
 * so each gets the flag people most expect for it: English the US, Spanish
 * Spain (Latin American Spanish Mexico), Portuguese Portugal (Brazilian
 * Portuguese Brazil), Arabic Saudi Arabia, Chinese China (Traditional
 * Chinese Taiwan). A tag that names a region ("en-GB", "fr-CA") gets that
 * region's flag when one is bundled. Languages with no sensible flag
 * (Esperanto, Latin, unknown) get none: the row keeps an empty slot so the
 * names still line up.
 *
 * The flags are SVGs from flag-icons (MIT, see THIRD-PARTY-NOTICES.txt),
 * bundled in src/assets/flags so nothing is fetched while watching.
 */
import { h } from './dom';
import { languageKey, UNKNOWN_LANGUAGE } from './languages';

/** The language part of a key ("pt" of "pt-BR") → the flag's file name. */
const BY_LANGUAGE: Record<string, string> = {
  af: 'za',
  am: 'et',
  ar: 'sa',
  az: 'az',
  be: 'by',
  bg: 'bg',
  bn: 'bd',
  bs: 'ba',
  ca: 'es-ct',
  cs: 'cz',
  cy: 'gb-wls',
  da: 'dk',
  de: 'de',
  el: 'gr',
  en: 'us',
  es: 'es',
  et: 'ee',
  eu: 'es-pv',
  fa: 'ir',
  fi: 'fi',
  fil: 'ph',
  fr: 'fr',
  ga: 'ie',
  gl: 'es-ga',
  gu: 'in',
  he: 'il',
  hi: 'in',
  hr: 'hr',
  hu: 'hu',
  hy: 'am',
  id: 'id',
  is: 'is',
  it: 'it',
  ja: 'jp',
  ka: 'ge',
  kk: 'kz',
  km: 'kh',
  kn: 'in',
  ko: 'kr',
  ku: 'iq',
  ky: 'kg',
  lb: 'lu',
  lo: 'la',
  lt: 'lt',
  lv: 'lv',
  mk: 'mk',
  ml: 'in',
  mn: 'mn',
  mr: 'in',
  ms: 'my',
  mt: 'mt',
  my: 'mm',
  nb: 'no',
  ne: 'np',
  nl: 'nl',
  nn: 'no',
  no: 'no',
  pa: 'in',
  pl: 'pl',
  ps: 'af',
  pt: 'pt',
  ro: 'ro',
  ru: 'ru',
  si: 'lk',
  sk: 'sk',
  sl: 'si',
  so: 'so',
  sq: 'al',
  sr: 'rs',
  sv: 'se',
  sw: 'ke',
  ta: 'in',
  te: 'in',
  tg: 'tj',
  th: 'th',
  tk: 'tm',
  tl: 'ph',
  tr: 'tr',
  uk: 'ua',
  ur: 'pk',
  uz: 'uz',
  vi: 'vn',
  yo: 'ng',
  zh: 'cn',
  zu: 'za',
};

/** Script subtags that point at a place on their own ("zh-Hant" is read in Taiwan and Hong Kong). */
const BY_SCRIPT: Record<string, string> = {
  'zh-hant': 'tw',
  'zh-hans': 'cn',
};

/** Region subtags that aren't a country: Latin America. */
const BY_AREA: Record<string, string> = {
  '419': 'mx',
};

const files = import.meta.glob<string>('../assets/flags/*.svg', { eager: true, query: '?url', import: 'default' });
const URLS: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url]));

/**
 * The flag's file name for a language code or key ("eng", "pt-BR",
 * "zh-Hant"), or null when the language has none. `bundled` says which
 * flags exist; tests pass their own.
 */
export function flagFor(code: string | null | undefined, bundled: (flag: string) => boolean = (flag) => Object.hasOwn(URLS, flag)): string | null {
  const key = languageKey(code);
  if (key === UNKNOWN_LANGUAGE) return null;
  const parts = key.split('-');
  const language = parts[0]!.toLowerCase();
  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    const candidate = BY_SCRIPT[`${language}-${lower}`] ?? BY_AREA[lower] ?? (/^[a-z]{2}$/.test(lower) ? lower : null);
    if (candidate && bundled(candidate)) return candidate;
  }
  const flag = BY_LANGUAGE[language];
  return flag && bundled(flag) ? flag : null;
}

/**
 * The flag before a language's name: a small picture the screen reader
 * skips (the name next to it says it all), or an empty slot of the same
 * size when the language has no flag, so names in a list line up.
 */
export function languageFlag(code: string | null | undefined): HTMLElement {
  const flag = flagFor(code);
  const slot = h('span', { class: `language-flag${flag ? '' : ' none'}`, 'aria-hidden': 'true' });
  if (flag) slot.dataset.flag = flag;
  if (flag) slot.append(h('img', { src: URLS[flag]!, alt: '', draggable: 'false', decoding: 'async' }));
  return slot;
}
