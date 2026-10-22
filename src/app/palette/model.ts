/**
 * The command palette's logic, apart from its drawing: matching candidates
 * against the query into capped, ordered groups, and the remembered recent
 * picks.
 */
import * as v from 'valibot';
import { fuzzyScore, prepare, type Prepared } from '../../lib/fuzzy';
import { SnapshotSchema } from '../../library/snapshot';

export const GROUPS = ['recent', 'suggested', 'yours', 'titles', 'settings', 'addons', 'actions'] as const;
export type GroupId = (typeof GROUPS)[number];

/** At most this many results per group, so one source can't push the others out of sight. */
export const GROUP_LIMITS: Record<GroupId, number> = { recent: 6, suggested: 6, yours: 6, titles: 8, settings: 6, addons: 4, actions: 5 };

/**
 * Where the titles group sits among the others: addon results arrive later,
 * so they get a fixed rank (a strong word-start match above, weaker ones
 * below) instead of moving the local groups when they come in.
 */
export const TITLES_RANK = 750;

/** Keyword matches count for less than the label's own, and never by loose letters. */
const KEYWORD_WEIGHT = 0.6;

export interface Candidate<T> {
  group: GroupId;
  /** Unique across the palette. */
  key: string;
  value: T;
  label: Prepared;
  keywords?: Prepared;
}

export function candidate<T>(group: GroupId, key: string, value: T, label: string, keywords?: string): Candidate<T> {
  return { group, key, value, label: prepare(label), ...(keywords ? { keywords: prepare(keywords) } : {}) };
}

export function scoreCandidate(query: Prepared, c: Candidate<unknown>): number | null {
  const own = fuzzyScore(query, c.label);
  const extra = c.keywords ? fuzzyScore(query, c.keywords, false) : null;
  if (own === null && extra === null) return null;
  return Math.max(own ?? -Infinity, extra === null ? -Infinity : extra * KEYWORD_WEIGHT);
}

export interface Group<T> {
  id: GroupId;
  /** The best score in it, which orders the groups. */
  best: number;
  items: T[];
}

/**
 * The candidates matching `query`, best first, in groups capped by
 * `limits` (GROUP_LIMITS unless given). Groups are ordered by their best
 * match; ties keep GROUPS' order. The first copy of a key wins.
 */
export function rankGroups<T>(candidates: readonly Candidate<T>[], query: string, limits: Record<GroupId, number> = GROUP_LIMITS): Group<T>[] {
  const q = prepare(query);
  // Only punctuation or symbols ("?", "-"): nothing to compare, where an empty query matches everything.
  if (!q.text && query.trim()) return [];
  const scored = new Map<GroupId, { c: Candidate<T>; score: number; index: number }[]>();
  const seen = new Set<string>();
  candidates.forEach((c, index) => {
    if (seen.has(c.key)) return;
    const score = scoreCandidate(q, c);
    if (score === null) return;
    seen.add(c.key);
    const list = scored.get(c.group) ?? [];
    list.push({ c, score, index });
    scored.set(c.group, list);
  });
  const groups: Group<T>[] = [];
  for (const [id, list] of scored) {
    list.sort((a, b) => b.score - a.score || a.index - b.index);
    groups.push({ id, best: list[0]!.score, items: list.slice(0, limits[id]).map((r) => r.c.value) });
  }
  return orderGroups(groups);
}

export function orderGroups<G extends { id: GroupId; best: number }>(groups: readonly G[]): G[] {
  return [...groups].sort((a, b) => b.best - a.best || GROUPS.indexOf(a.id) - GROUPS.indexOf(b.id));
}

// ── Recent picks ──

export const RECENT_KEY = 'palette.recent';
export const MAX_RECENT = 8;

const Id = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
/**
 * Picks are remembered per profile (`palette.recent.<profile id>`). Titles,
 * lists and addons also carry their profile's id, from when one list was
 * shared by every profile; they still only show there.
 */
const RecentSchema = v.variant('kind', [
  v.object({ kind: v.literal('setting'), id: Id }),
  v.object({ kind: v.literal('action'), id: Id }),
  v.object({ kind: v.literal('addon'), key: Id, name: v.pipe(v.string(), v.maxLength(200)), profile: Id }),
  v.object({ kind: v.literal('list'), id: Id, profile: Id }),
  v.object({ kind: v.literal('title'), title: SnapshotSchema, profile: Id }),
]);

export type Recent = v.InferOutput<typeof RecentSchema>;

export function recentKey(entry: Recent): string {
  switch (entry.kind) {
    case 'addon':
      return `addon:${entry.key}`;
    case 'title':
      return `title:${entry.title.meta.id}`;
    default:
      return `${entry.kind}:${entry.id}`;
  }
}

/** A recent pick as stored, validated; null if it isn't one. */
export function parseRecentEntry(value: unknown): Recent | null {
  const parsed = v.safeParse(RecentSchema, value);
  return parsed.success ? parsed.output : null;
}

/** Recent picks as stored in settings; anything malformed or repeated is dropped. */
export function parseRecents(value: unknown): Recent[] {
  if (!Array.isArray(value)) return [];
  const out: Recent[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, MAX_RECENT * 2)) {
    const entry = parseRecentEntry(raw);
    if (!entry || seen.has(recentKey(entry))) continue;
    seen.add(recentKey(entry));
    out.push(entry);
    if (out.length === MAX_RECENT) break;
  }
  return out;
}

/** Puts `entry` first, dropping an earlier copy and the oldest past the limit. */
export function addRecent(recent: readonly Recent[], entry: Recent): Recent[] {
  const key = recentKey(entry);
  return [entry, ...recent.filter((r) => recentKey(r) !== key)].slice(0, MAX_RECENT);
}

/** `saved` with the picks made before it was read (`queued`, oldest first) put in front, newest first. */
export const withQueuedRecents = (saved: readonly Recent[], queued: readonly Recent[]): Recent[] => queued.reduce<Recent[]>((list, entry) => addRecent(list, entry), [...saved]);

/** The picks to show to `profile`: shared ones, and its own. */
export const recentsFor = (recent: readonly Recent[], profile: string | null) => recent.filter((r) => !('profile' in r) || r.profile === profile);
