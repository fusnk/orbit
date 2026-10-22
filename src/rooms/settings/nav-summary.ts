/**
 * The short line under each category in the Settings sidebar, saying what
 * it's set to now ("Crimson · Inter · Cinematic banner"). Built here from
 * plain values, apart from reading them (nav-summary-live.ts), so each line
 * can be tested. Only names and counts go in: never a URL, key or path.
 */
import { locale, t, tn } from '../../i18n';

const SEPARATOR = ' · ';
/** Addon names come from manifests: one short line each, whatever they hold. */
const NAME_MAX = 40;

const percent = (value: number) => new Intl.NumberFormat(locale(), { style: 'percent' }).format(value);
const join = (parts: readonly (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p).join(SEPARATOR);

/** A name from outside Orbit (an addon's manifest) as one plain, short line. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const line = name.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
}

/** The first of `names`, then how many more: "Open Films + 4 more". */
function firstAndMore(names: readonly string[]): string {
  const [first, ...rest] = names;
  if (first === undefined) return '';
  return rest.length ? t('navsummary.more', { name: first, count: rest.length }) : first;
}

export const generalSummary = (s: { language: string; scale: number }) => join([s.language, t('navsummary.scale', { percent: percent(s.scale / 100) })]);

export const appearanceSummary = (s: { theme: string; fonts: string; banner: string }) => join([s.theme, s.fonts, t('navsummary.banner', { style: s.banner })]);

export const homeLibrarySummary = (s: { watchedAt: number; spoilersHidden: boolean }) =>
  join([t('navsummary.watched-at', { percent: percent(s.watchedAt) }), t(s.spoilersHidden ? 'navsummary.spoilers-hidden' : 'navsummary.spoilers-shown')]);

/** Quality and torrents live under Addons → Source preferences now, so they aren't named here. */
export const playbackSummary = (s: { autoplay: string }) => t('navsummary.autoplay', { mode: s.autoplay });

export const playerSummary = (s: { layout: string }) => t('navsummary.player-layout', { name: s.layout });

/** `languages` by name in the person's order (empty: the video's own); `size` relative to the default, 1 being 100%. */
/** The languages, then the font and size only when they aren't the defaults (no font means the default one). */
export const subtitlesSummary = (s: { languages: readonly string[]; font?: string | undefined; size: number }) =>
  join([firstAndMore(s.languages) || t('settings.subtitles.video-default'), s.font, s.size !== 1 && t('navsummary.size', { percent: percent(s.size) })]);

export const pictureSoundSummary = (s: { quality: string; hdr: boolean }) => join([s.quality, s.hdr && 'HDR']);

/** Enabled addons' names, the person's own before the built-ins. */
export function addonsSummary(names: readonly string[]): string {
  const clean = names.map(cleanName).filter(Boolean);
  return clean.length ? firstAndMore(clean) : t('navsummary.no-addons');
}

/** Which services this profile is connected to, by name, in the Accounts page's order. */
export const connectedServices = (c: { stremio: boolean; jellyfin: boolean; plex: boolean; cloud: readonly string[]; letterboxd: boolean; anilist: boolean }): string[] => [
  ...(c.stremio ? ['Stremio'] : []),
  ...(c.anilist ? ['AniList'] : []),
  ...(c.jellyfin ? ['Jellyfin'] : []),
  ...(c.plex ? ['Plex'] : []),
  ...c.cloud,
  ...(c.letterboxd ? ['Letterboxd'] : []),
];

/** The services this profile is connected to, by name. */
export const accountsSummary = (names: readonly string[]) => (names.length ? names.join(SEPARATOR) : t('navsummary.not-connected'));

export const downloadsSummary = (s: { done: number; active: number }) =>
  s.done || s.active ? join([s.done > 0 && tn('navsummary.downloads.done', s.done), s.active > 0 && tn('navsummary.downloads.active', s.active)]) : t('navsummary.downloads.none');

export const shortcutsSummary = (count: number) => tn('navsummary.shortcuts', count);
