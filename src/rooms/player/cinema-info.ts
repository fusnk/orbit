/**
 * What the Cinema layout's Info panel says and when its second pill shows
 * (see cinema.ts), apart from the DOM so it can be tested.
 */
import { runtimeMinutes } from '../../catalog/runtime';
import { displayYear, type Title } from '../../catalog/titles';
import { t } from '../../i18n';
import { qualityBadges, qualityTraits } from '../../lib/quality-badges';
import { qualityLabel } from './format';
import type { TrackInfo } from './tracks';

/** A runtime as the locale writes it ("1 hr, 32 min"); the addon's own text when it can't be read. */
export function runtimeText(runtime: string | undefined, locale: string): string {
  const minutes = runtimeMinutes(runtime);
  if (!minutes) return runtime?.trim() ?? '';
  const unit = (value: number, name: 'hour' | 'minute') => new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
  const hours = Math.floor(minutes / 60);
  const parts = [hours ? unit(hours, 'hour') : '', minutes % 60 ? unit(minutes % 60, 'minute') : ''].filter(Boolean);
  return new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(parts);
}

/** The Info panel's meta line: the first genre, the year and the runtime, blanks left out. */
export function infoMeta(title: Pick<Title, 'genres' | 'year' | 'runtime'>, locale: string): string[] {
  return [title.genres.find((genre) => genre.trim()) ?? '', displayYear(title.year?.trim()) ?? '', runtimeText(title.runtime, locale)].map((part) => part.trim()).filter(Boolean);
}

/**
 * Badges for what's playing: its picture as mpv reports it ("1080p"), HDR or
 * Dolby Vision and Atmos when the source's name says so, and "CC" when the
 * file has subtitles. The resolution comes from mpv, not the name, so a
 * mislabelled release can't claim 4K.
 */
export function streamBadges(height: number | null, source: { label: string; meta: string; filename?: string | undefined }, tracks: readonly TrackInfo[]): string[] {
  const named = qualityBadges([qualityTraits({ name: source.label, description: source.meta, filename: source.filename })]).filter((badge) => badge !== '4K');
  const picture = qualityLabel(height);
  return [...(picture ? [picture] : []), ...named, ...(tracks.some((track) => track.kind === 'sub') ? [t('playerlook.cinema.cc')] : [])];
}

/** What the second pill opens: a series' episodes, a film's "More like this", or nothing (it hides). */
export function continueTarget(title: Pick<Title, 'seasons'>, similar: number, playing: { live?: boolean | undefined; trailer?: boolean | undefined }): 'episodes' | 'similar' | null {
  if (playing.live || playing.trailer) return null;
  if (title.seasons?.length) return 'episodes';
  return similar > 0 ? 'similar' : null;
}
