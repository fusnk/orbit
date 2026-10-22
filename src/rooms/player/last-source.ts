/**
 * The source each movie or episode last played from, so resuming it can
 * offer "Continue with last source" (see detail/resume-choice.ts).
 *
 * Kept per profile, for the 100 most recent. Like failed-sources.ts, a
 * source is remembered by digests, never its address: stream URLs can hold
 * debrid keys. What's kept to show is only what the source picker shows
 * anyway: the addon's name, the quality and the release details.
 */
import * as v from 'valibot';
import { t } from '../../i18n';
import { hash, sourceDigest } from './failed-sources';
import type { PlayableSource } from './panels';
import { profileStore } from './profile-store';

export const LAST_SOURCE_PREFIX = 'player.last-source';
export const MAX_LAST_SOURCES = 100;
const MAX_WHERE = 100;
const MAX_TEXT = 200;
const MAX_BYTES = 60_000;

export interface LastSource {
  /** The movie or episode (see `whereKey`). */
  where: string;
  /** Addon and address (see `sourceDigest`). */
  digest: string;
  /** Addon, file name and size: finds the same release when an addon's links change between visits. '' without a file name. */
  name: string;
  addon: string;
  /** e.g. "1080p". */
  label: string;
  /** e.g. "HDR10 · x265 · 4.2 GB". */
  meta: string;
  /** The release's file name, if the addon gave one. */
  filename: string;
  at: number;
}

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const DIGEST = v.pipe(v.string(), v.regex(/^[0-9a-f]{1,16}$/));
const EntrySchema = v.object({
  where: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_WHERE)),
  digest: DIGEST,
  name: v.union([v.literal(''), DIGEST]),
  addon: text(MAX_TEXT),
  label: text(MAX_TEXT),
  meta: text(MAX_TEXT),
  filename: text(MAX_TEXT),
  at: v.pipe(v.number(), v.finite(), v.minValue(0)),
});

/** Shown as text only; control characters and length are trimmed anyway. */
const clean = (value: string | undefined) => (value ?? '').replace(/\p{Cc}/gu, ' ').slice(0, MAX_TEXT);

/** A release's identity apart from its address: addon, file name and size. '' when there's no file name to go on. */
export function nameDigest(addon: string, filename: string | undefined, size: number | undefined): string {
  return filename ? hash(`${addon}\n${filename}\n${size ?? ''}`) : '';
}

/** What to remember about `source` having played for `where`. */
export function lastSourceOf(where: string, source: PlayableSource, at: number): LastSource {
  return {
    where,
    digest: sourceDigest(source.addon, source.url),
    name: nameDigest(source.addon, source.filename, source.videoSize),
    addon: clean(source.addon),
    label: clean(source.label),
    meta: clean(source.meta),
    filename: clean(source.filename),
    at,
  };
}

/** Saved entries, oldest first, minus junk; one per movie or episode (the latest). */
export function parseLastSources(value: unknown): LastSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: LastSource[] = [];
  for (const raw of [...value].reverse()) {
    const parsed = v.safeParse(EntrySchema, raw);
    if (!parsed.success || seen.has(parsed.output.where)) continue;
    seen.add(parsed.output.where);
    entries.push(parsed.output);
  }
  return entries.slice(0, MAX_LAST_SOURCES).reverse();
}

/** Notes `entry` as the latest for its movie or episode; the oldest go past the cap. */
export function rememberLast(entries: readonly LastSource[], entry: LastSource): LastSource[] {
  if (entry.where.length > MAX_WHERE) return [...entries];
  const next = [...entries.filter((e) => e.where !== entry.where), entry].slice(-MAX_LAST_SOURCES);
  // Settings hold 64 KB each.
  while (next.length > 1 && JSON.stringify(next).length > MAX_BYTES) next.shift();
  return next;
}

export const lastIn = (entries: readonly LastSource[], where: string): LastSource | undefined => entries.find((e) => e.where === where);

/** The same source among `sources` (found again just now): by address first, else by release. */
export function findLast<T extends PlayableSource>(sources: readonly T[], last: LastSource): T | undefined {
  return sources.find((s) => sourceDigest(s.addon, s.url) === last.digest) ?? (last.name ? sources.find((s) => nameDigest(s.addon, s.filename, s.videoSize) === last.name) : undefined);
}

const store = profileStore(LAST_SOURCE_PREFIX, parseLastSources);

/** The source `where` last played from, if known. */
export async function lastSourceFor(where: string): Promise<LastSource | undefined> {
  await store.load();
  return lastIn(store.get(), where);
}

/** `source` started playing for `where`. */
export function rememberSource(where: string, source: PlayableSource): void {
  void store.record((list) => rememberLast(list, lastSourceOf(where, source, Date.now())));
}

// ── Settings → Playback → When resuming (the prompt itself is detail/resume-choice.ts) ──

/** Per profile (it's taste): 'ask' (default), 'last', 'choose' or 'best'. */
export const RESUME_SOURCE_PREFIX = 'playback.resume-source';
export const RESUME_SOURCE_MODES = ['ask', 'last', 'choose', 'best'] as const;
export type ResumeSourceMode = (typeof RESUME_SOURCE_MODES)[number];
export const parseResumeSourceMode = (value: unknown): ResumeSourceMode => RESUME_SOURCE_MODES.find((m) => m === value) ?? 'ask';

/** What to do: play the last source (found again), open the picker, or play the best. */
export type ResumeChoice = { kind: 'last'; last: LastSource } | { kind: 'choose' } | { kind: 'best' };

/**
 * What resuming should do, from the setting and what's known. Undefined:
 * nothing to decide (no last source and no fixed choice), so Play's usual
 * rule applies, as before this setting existed. 'ask' means show the prompt.
 */
export function decideResume(mode: ResumeSourceMode, last: LastSource | undefined): ResumeChoice | 'ask' | undefined {
  if (mode === 'choose' || mode === 'best') return { kind: mode };
  if (!last) return undefined;
  return mode === 'last' ? { kind: 'last', last } : 'ask';
}

/** The release's details as one line, e.g. "Open Films · 1080p · HDR10 · 4.2 GB". */
export const lastSourceLine = (last: LastSource) => [last.addon || t('player.source.unnamed'), last.label, last.meta].filter(Boolean).join(' · ');
