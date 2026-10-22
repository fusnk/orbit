/**
 * What ambient mode shows: titles with a backdrop, from what the person is
 * watching and has saved ("For you"), from what's popular ("Trending"), or
 * both taking turns. Pure, so the order is easy to test.
 */
import type { Title } from '../../catalog/titles';
import type { ContinueEntry } from '../../library/watch';
import { t } from '../../i18n';

export const AMBIENT_SOURCES = ['for-you', 'trending', 'both'] as const;
export type AmbientSource = (typeof AMBIENT_SOURCES)[number];

/** More than anyone sits through; keeps the list (and its lookups) small. */
export const MAX_SLIDES = 40;

export type SlideKind = 'continue' | 'library' | 'recent' | 'trending';

export interface Slide {
  title: Title;
  kind: SlideKind;
  /** e.g. "Resume S2 · E4 · 23m left", for Continue Watching. */
  note?: string;
}

export interface SlideSources {
  continueWatching: readonly ContinueEntry[];
  library: readonly Title[];
  recent: readonly Title[];
  trending: readonly Title[];
}

/** Only https artwork: the same images the rest of the app already loads (the CSP allows no other). */
const hasBackdrop = (title: Title) => typeof title.background === 'string' && title.background.startsWith('https://');

/** The quiet line over a Continue Watching slide. */
export function continueNote(entry: ContinueEntry): string {
  // A next episode: "Next episode · S2 · E5 · Title".
  if (!entry.left) return [entry.badge, entry.sub].filter(Boolean).join(' · ');
  // In progress: a series' `sub` is its episode code; a movie's is its year and runtime, which the slide shows anyway.
  const resume = entry.title.type === 'series' && entry.sub ? t('ambient.slide.resume-episode', { episode: entry.sub }) : t('ambient.slide.resume');
  return `${resume} · ${entry.left}`;
}

/** "2019 · Drama, Thriller": year and up to two genres, blanks left out. */
export function slideMeta(title: Title): string {
  const genres = title.genres
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  return [title.year?.trim(), genres].filter(Boolean).join(' · ');
}

/**
 * The slides for `source`, in order, each title once (its first, most
 * personal appearance wins) and only titles with a backdrop. "Both" takes
 * turns, personal first, so neither kind runs for long.
 */
export function pickSlides(source: AmbientSource, from: SlideSources): Slide[] {
  const personal: Slide[] = [
    ...from.continueWatching.map((entry): Slide => ({ title: entry.title, kind: 'continue', note: continueNote(entry) })),
    ...from.library.map((title): Slide => ({ title, kind: 'library' })),
    ...from.recent.map((title): Slide => ({ title, kind: 'recent' })),
  ];
  const trending = from.trending.map((title): Slide => ({ title, kind: 'trending' }));
  if (source === 'for-you') return dedupe(personal).slice(0, MAX_SLIDES);
  if (source === 'trending') return dedupe(trending).slice(0, MAX_SLIDES);
  const mine = dedupe(personal);
  const ids = new Set(mine.map((slide) => slide.title.id));
  return alternate(mine, dedupe(trending).filter((slide) => !ids.has(slide.title.id))).slice(0, MAX_SLIDES);
}

/**
 * The slides the profile's content limit allows (`allowed` is catalog/parental's
 * `allowedTitles`), in order. Ambient mode fills the screen with a title's
 * backdrop, logo and details, Trending's straight from a catalog: on a Kids
 * profile that must be what its rows would show, not whatever is popular.
 */
export async function allowedSlides(slides: readonly Slide[], allowed: (titles: readonly Title[]) => Promise<Title[]>): Promise<Slide[]> {
  const kept = new Set((await allowed(slides.map((slide) => slide.title))).map((title) => title.id));
  return slides.filter((slide) => kept.has(slide.title.id));
}

function dedupe(slides: readonly Slide[]): Slide[] {
  const seen = new Set<string>();
  return slides.filter((slide) => {
    if (!hasBackdrop(slide.title) || seen.has(slide.title.id)) return false;
    seen.add(slide.title.id);
    return true;
  });
}

function alternate<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}
