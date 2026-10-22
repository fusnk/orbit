/**
 * Home's layout (Settings → Library & Metadata → Home rows): the order and
 * visibility of its rows, each rail's style, and rows the person added
 * (a catalog, a genre of one, a list, My Library, a streaming service, a
 * mood, a Jellyfin or Plex row, collections). Home tags each row with a stable id; saved ids are reordered among
 * themselves, and rows that weren't saved yet (e.g. a new addon's catalog)
 * keep their default place.
 *
 * It's kept per profile. A profile's first read starts from the old
 * all-profile order and hidden rows ('home.rows'), so nobody's Home moves;
 * only a new setup gets the default mood rows.
 */
import * as v from 'valibot';
import { settings } from '../../lib/ipc';
import { activeProfileId } from '../../library/profiles';
import { DEFAULT_MOODS, MOODS } from './moods';

export const ROW_STYLES = ['poster', 'landscape', 'top10'] as const;
export type RowStyle = (typeof ROW_STYLES)[number];

export interface HomeRow {
  id: string;
  label: string;
  /** The row's current style, when it's a rail that can change style. */
  style?: RowStyle;
  /** Rows the person added can be renamed and removed. */
  added?: boolean;
}

export interface RowPrefs {
  /** Row ids in the chosen order. */
  order: string[];
  hidden: string[];
}

const Text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));

/**
 * Where an added row's titles come from. Catalog fields are matched against
 * the installed addons when Home draws, so a stale or hand-edited one just
 * shows nothing.
 */
const SourceSchema = v.variant('kind', [
  v.object({ kind: v.literal('catalog'), addon: Text(200), type: Text(64), catalog: Text(200), genre: v.optional(Text(100)) }),
  v.object({ kind: v.literal('list'), list: Text(100) }),
  v.object({ kind: v.literal('library') }),
  v.object({ kind: v.literal('service'), service: v.pipe(v.string(), v.regex(/^[a-z]{1,20}$/)) }),
  v.object({ kind: v.literal('mood'), mood: v.picklist(MOODS) }),
  // The profile's Jellyfin server: Continue watching, Recently added, or one library (by Jellyfin id).
  v.object({ kind: v.literal('jellyfin'), feed: v.picklist(['resume', 'latest', 'library']), library: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/))) }),
  // The profile's Plex server: On Deck, Recently added, or one library (by its section key).
  v.object({ kind: v.literal('plex'), feed: v.picklist(['resume', 'latest', 'library']), library: v.optional(v.pipe(v.string(), v.regex(/^\d{1,12}$/))) }),
  // The profile's custom collections as tiles: all of them, or one group's (a collections file's own rows).
  v.object({ kind: v.literal('collections'), group: v.optional(Text(60)) }),
  // Tiles (dashboard.ts): new episode, downloads and My Library at a glance; moods and Surprise me; Live TV favourites on now.
  v.object({ kind: v.literal('status') }),
  v.object({ kind: v.literal('today') }),
  v.object({ kind: v.literal('live') }),
]);
export type RowSource = v.InferOutput<typeof SourceSchema>;

const ADDED_ID = /^row-[a-z0-9-]{1,40}$/;
const MAX_NAME = 60;

const AddedSchema = v.object({
  id: v.pipe(v.string(), v.regex(ADDED_ID)),
  source: SourceSchema,
  // Control characters dropped; an empty name means the row's own.
  name: v.fallback(v.optional(v.pipe(v.string(), v.transform((s) => s.replace(/\p{Cc}/gu, '').trim().slice(0, MAX_NAME) || undefined))), undefined),
});
export type AddedRow = v.InferOutput<typeof AddedSchema>;

export interface HomeLayout extends RowPrefs {
  /** Chosen styles by row id; rows not listed use their default. */
  styles: Record<string, RowStyle>;
  added: AddedRow[];
  /** Rows drawn at half width: two in a row share a line (see `pairHalves`). Absent in older layouts. */
  half?: string[];
  /** The banner lists what's next beside it, with its age rating and known picture quality. */
  heroNext?: true;
  /** "Good evening, Sam" above the rows, and tags on cards ("New episode"); both on unless turned off. */
  greeting?: false;
  cardTags?: false;
  /** The layout before a preset replaced it, so "Restore previous layout" can bring it back. */
  previous?: SavedLayout;
}

/** A layout as kept inside another one (`previous`), which never nests further. */
export type SavedLayout = Omit<HomeLayout, 'previous'>;

/** More than enough rows, and keeps the setting well under its size limit. */
export const MAX_ADDED = 40;

const LEGACY_KEY = 'home.rows';
/** Dispatched on `document` when the layout changes. */
export const HOME_ROWS_CHANGED = 'orbit:home-rows-changed';
/** Dispatched on `document` when Home has drawn its rows (so Settings can list them). */
export const HOME_ROWS_KNOWN = 'orbit:home-rows-known';

/** The rows Home showed last, for the settings list. */
let known: HomeRow[] = [];
export const knownRows = (): HomeRow[] => known;
export function setKnownRows(rows: HomeRow[]): void {
  known = rows;
  document.dispatchEvent(new Event(HOME_ROWS_KNOWN));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Saved order and hidden rows, keeping only strings. */
export function parseRowPrefs(value: unknown): RowPrefs {
  const saved = isRecord(value) ? value : {};
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  return { order: ids(saved.order), hidden: ids(saved.hidden) };
}

/** A saved layout; anything that doesn't validate falls back to the default, field by field and row by row. */
export function parseLayout(value: unknown): HomeLayout {
  const saved = isRecord(value) ? value : {};
  const layout = parseOwn(saved);
  return isRecord(saved.previous) ? { ...layout, previous: parseOwn(saved.previous) } : layout;
}

/** One level of a saved layout. Fields older layouts lack are left out rather than defaulted, so they read back unchanged. */
function parseOwn(saved: Record<string, unknown>): SavedLayout {
  const styles = isRecord(saved.styles)
    ? // fromEntries defines own properties, so a "__proto__" key can't reach the prototype.
      Object.fromEntries(Object.entries(saved.styles).filter((entry): entry is [string, RowStyle] => v.is(v.picklist(ROW_STYLES), entry[1])))
    : {};
  const ids = new Set<string>();
  const added = (Array.isArray(saved.added) ? saved.added : []).flatMap((raw) => {
    const row = v.safeParse(AddedSchema, raw);
    if (!row.success || ids.has(row.output.id)) return [];
    ids.add(row.output.id);
    return [row.output];
  });
  const half = parseRowPrefs({ order: saved.half }).order;
  return { ...parseRowPrefs(saved), styles, added: added.slice(0, MAX_ADDED), ...(half.length ? { half } : {}), ...(saved.heroNext === true ? { heroNext: true as const } : {}), ...shownExtras(saved) };
}

/** The greeting and card tags when turned off (they're on by default, so only `false` is kept). */
function shownExtras(saved: Partial<Record<HomeExtra, unknown>>): Pick<HomeLayout, HomeExtra> {
  return { ...(saved.greeting === false ? { greeting: false as const } : {}), ...(saved.cardTags === false ? { cardTags: false as const } : {}) };
}

/** Home's switches that aren't about rows; presets and Reset leave them as they are. */
export type HomeExtra = 'greeting' | 'cardTags';

/** The layout with the greeting or card tags on or off. */
export function withExtra(layout: HomeLayout, extra: HomeExtra, on: boolean): HomeLayout {
  const next = { ...layout };
  if (on) delete next[extra];
  else next[extra] = false;
  return next;
}

/**
 * A profile's first layout: the old shared order and hidden rows, and for a
 * new setup (`fresh`: nothing saved or watched yet) the default mood rows.
 */
export function initialLayout(legacy: unknown, fresh: boolean): HomeLayout {
  return {
    ...parseRowPrefs(legacy),
    styles: {},
    added: fresh ? DEFAULT_MOODS.map((mood) => ({ id: `row-mood-${mood}`, source: { kind: 'mood', mood } })) : [],
  };
}

/** The settings key for a profile's layout (keys are lowercase letters, digits and . _ -). */
export function layoutKey(profileId: string | null): string {
  return profileId && /^[a-z0-9._-]{1,40}$/.test(profileId) ? `home.layout.${profileId}` : 'home.layout';
}

/**
 * A row's style: the one picked for it in the Home builder, or its default.
 * A poster rail's default is Settings → Appearance → Card shape
 * (`base`); Top 10 rows keep theirs.
 */
export function styleOf(layout: HomeLayout, id: string, fallback: RowStyle, base: 'poster' | 'landscape' = 'poster'): RowStyle {
  if (Object.hasOwn(layout.styles, id)) return layout.styles[id]!;
  return fallback === 'poster' ? base : fallback;
}

/** A fresh id for an added row. */
export function newRowId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `row-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

let current: Promise<HomeLayout> | null = null;
/** Says whether the profile is new to Orbit; set by Home (it knows about history and My Library). */
let isFresh: () => boolean = () => false;
export function setFreshCheck(check: () => boolean): void {
  isFresh = check;
}

/** The active profile's layout. Its first read is saved, so the defaults it got don't change later. */
export function homeLayout(): Promise<HomeLayout> {
  current ??= (async () => {
    const key = layoutKey(await activeProfileId().catch(() => null));
    const saved = await settings.get(key).catch(() => null);
    if (saved !== null && saved !== undefined) return parseLayout(saved);
    const legacy = await settings.get(LEGACY_KEY).catch(() => null);
    const layout = initialLayout(legacy, (legacy === null || legacy === undefined) && isFresh());
    await settings.set(key, layout).catch((err: unknown) => console.warn('Could not save the Home layout', err));
    return layout;
  })();
  return current;
}

/** Saves one layout at a time, so an older one can't land after a newer one. */
let saving: Promise<unknown> = Promise.resolve();
function persist(layout: HomeLayout): Promise<void> {
  const done = saving.then(async () => {
    const key = layoutKey(await activeProfileId().catch(() => null));
    await settings.set(key, layout);
    document.dispatchEvent(new Event(HOME_ROWS_CHANGED));
  });
  saving = done.catch(() => {});
  return done;
}

export async function saveLayout(layout: HomeLayout): Promise<void> {
  current = Promise.resolve(layout);
  await persist(layout);
}

/**
 * Applies `change` to the saved layout and saves it. The new layout becomes
 * the current one at once, so a change made while this one saves builds on
 * it instead of overwriting it.
 */
export async function updateLayout(change: (layout: HomeLayout) => HomeLayout): Promise<void> {
  const next = homeLayout().then(change);
  current = next;
  await persist(await next);
}

export async function rowPrefs(): Promise<RowPrefs> {
  const { order, hidden } = await homeLayout();
  return { order, hidden };
}

export async function saveRowPrefs(prefs: RowPrefs): Promise<void> {
  await updateLayout((layout) => ({ ...layout, order: prefs.order, hidden: prefs.hidden }));
}

/**
 * `ids` in their default order, rearranged by `order`: the slots that saved
 * ids occupy are refilled in the saved order; unsaved ids stay where they are.
 */
export function arrange(ids: readonly string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const saved = ids.filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  let next = 0;
  return ids.map((id) => (rank.has(id) ? saved[next++]! : id));
}

/**
 * The saved order with the rows shown now put in `arranged`'s order. Saved
 * rows that aren't shown now (TMDB's while it's disconnected, an addon's
 * while it's missing) stay, just after the shown row they followed, so their
 * place is still there when they come back.
 */
export function keepUnshown(arranged: readonly string[], order: readonly string[]): string[] {
  const shown = new Set(arranged);
  const after = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const id of order) {
    if (shown.has(id)) anchor = id;
    else after.set(anchor, [...(after.get(anchor) ?? []), id]);
  }
  return [...(after.get(null) ?? []), ...arranged.flatMap((id) => [id, ...(after.get(id) ?? [])])];
}

/** The saved order after moving row `id` `by` places among the rows shown (`ids`, as `order` arranges them); unchanged at either end. */
export function movedOrder(ids: readonly string[], order: readonly string[], id: string, by: number): string[] {
  const arranged = arrange(ids, order);
  const from = arranged.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= arranged.length) return [...order];
  arranged.splice(from, 1);
  arranged.splice(to, 0, id);
  return keepUnshown(arranged, order);
}

/**
 * What Home's draw does with a row: keep it as drawn, make it (again), or
 * leave it unmade for now. A rail starts loading its titles as soon as it's
 * made, so a hidden row waits until it's shown; one already made stays while
 * its style, name and contents (`sig`) don't change.
 */
export function drawStep(row: { sig: string; made: boolean } | undefined, sig: string, hidden: boolean): 'keep' | 'make' | 'defer' {
  if (row && row.sig === sig && (row.made || hidden)) return 'keep';
  return hidden ? 'defer' : 'make';
}

/**
 * Which rows share a line, by id: consecutive half-width rows pair up in
 * order ('start' then 'end'); one without a half-width neighbour is drawn
 * full width. `visible` is Home's rows as shown (hidden ones left out).
 */
export function pairHalves(visible: readonly string[], half: readonly string[]): Map<string, 'start' | 'end'> {
  const halves = new Set(half);
  const pairs = new Map<string, 'start' | 'end'>();
  for (let i = 0; i < visible.length - 1; i++) {
    if (!halves.has(visible[i]!) || !halves.has(visible[i + 1]!)) continue;
    pairs.set(visible[i]!, 'start');
    pairs.set(visible[++i]!, 'end');
  }
  return pairs;
}

/** "Reset": Home's own order, nothing hidden, default styles and banner. Added rows (and a layout to restore) stay. */
export function resetArrangement(layout: HomeLayout): HomeLayout {
  return { order: [], hidden: [], styles: {}, added: layout.added, ...shownExtras(layout), ...(layout.previous ? { previous: layout.previous } : {}) };
}

/** The rows a Dashboard's tiles come from, in the order it shows them. */
const DASHBOARD_TILES = ['status', 'today', 'live'] as const;
/** Home's "Trending" row: TMDB's when connected, otherwise the first movie catalog's Top 10. */
const TRENDING_ROWS = ['tmdb-trending-week', 'top'];

/**
 * The Dashboard preset: the banner with what's next beside it; Continue
 * Watching beside the status tiles; "Today on Orbit" beside Trending (as a
 * Top 10); then Live TV on now, and every other row after them as arranged
 * before. Tile rows are added when missing (and room is left for them). The
 * layout it replaces is kept for "Restore previous layout"; applying it again
 * keeps the first one.
 */
export function dashboardLayout(layout: HomeLayout, shown: readonly string[], makeId: () => string = newRowId): HomeLayout {
  const { previous, ...own } = layout;
  const added = [...layout.added];
  const tileIds = DASHBOARD_TILES.map((kind) => {
    const existing = added.find((row) => row.source.kind === kind);
    if (existing) return existing.id;
    if (added.length >= MAX_ADDED) return null;
    const id = makeId();
    added.push({ id, source: { kind } });
    return id;
  });
  const [status, today, live] = tileIds;
  const trending = TRENDING_ROWS.find((id) => shown.includes(id)) ?? null;
  const continueRow = shown.includes('continue') ? 'continue' : null;
  const head = [continueRow, status, today, trending, live].filter((id): id is string => !!id);
  // Saved rows not shown now (TMDB's while it's disconnected) keep their place among the rest.
  const kept = keepUnshown(arrange(shown, layout.order), layout.order);
  const rest = [...kept, ...added.map((row) => row.id).filter((id) => !kept.includes(id))].filter((id) => !head.includes(id));
  return {
    order: [...head, ...rest],
    hidden: layout.hidden.filter((id) => !head.includes(id)),
    styles: trending ? { ...layout.styles, [trending]: 'top10' } : layout.styles,
    added,
    half: [continueRow, status, today, trending].filter((id): id is string => !!id),
    heroNext: true,
    ...shownExtras(layout),
    previous: previous ?? own,
  };
}

/** The layout with row `id` at half width or not. */
export function withHalf(layout: HomeLayout, id: string, on: boolean): HomeLayout {
  const half = (layout.half ?? []).filter((other) => other !== id);
  if (on) half.push(id);
  const next = { ...layout };
  if (half.length) next.half = half;
  else delete next.half;
  return next;
}

/** The layout with the banner's "what's next" list on or off. */
export function withHeroNext(layout: HomeLayout, on: boolean): HomeLayout {
  const next = { ...layout };
  if (on) next.heroNext = true;
  else delete next.heroNext;
  return next;
}

/** Back to the layout a preset replaced (as it was, rows and all; the greeting and card tags stay as they are); unchanged when there's none. */
export function restorePrevious(layout: HomeLayout): HomeLayout {
  if (!layout.previous) return layout;
  const restored: HomeLayout = { ...layout.previous };
  delete restored.greeting;
  delete restored.cardTags;
  return { ...restored, ...shownExtras(layout) };
}

/** A first Jellyfin or Plex server puts its "Recently added" row at the end of Home. */
export async function addServerLatestRow(kind: 'jellyfin' | 'plex'): Promise<void> {
  const shown = knownRows().map((r) => r.id);
  await updateLayout((layout) => {
    if (layout.added.length >= MAX_ADDED || layout.added.some((r) => r.source.kind === kind && r.source.feed === 'latest')) return layout;
    const id = newRowId();
    return { ...layout, added: [...layout.added, { id, source: { kind, feed: 'latest' } }], order: shown.length ? [...keepUnshown(arrange(shown, layout.order), layout.order), id] : [...layout.order, id] };
  });
}
