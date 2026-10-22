/**
 * Where the navigation lives and what's in it (Theme Studio → Layout): the
 * top bar (Orbit's own), a sidebar with labels or an icon rail on either
 * side, a floating pill, a cinematic bar that floats over the page and
 * fades while it scrolls, or the Arc bar (plain links after the wordmark,
 * the current page marked by an arc of the logo's ring: nav-layouts.css). The floating pill (stored as 'dock',
 * its name before it could move) sits in any of six places: top or bottom,
 * at the start, middle or end. Items can be reordered, renamed and
 * hidden; Settings isn't one of them (it's the title bar's own button), so
 * it stays reachable whatever is hidden.
 *
 * The top bars can also put the nav just after the wordmark instead of in
 * the middle.
 *
 * Applied as data attributes on <html> (nav-layouts.css draws each
 * variant) and an event the nav listens for, so the nav is the same
 * element in every layout and spatial navigation keeps working.
 */
import * as v from 'valibot';

export const NAV_POSITIONS = ['top', 'sidebar', 'rail', 'dock', 'cinematic', 'arc'] as const;
export type NavPosition = (typeof NAV_POSITIONS)[number];
/** Start is left in left-to-right languages and right in Arabic. */
export const NAV_SIDES = ['start', 'end'] as const;
export type NavSide = (typeof NAV_SIDES)[number];
/** Where a top bar's nav sits: the middle of the bar, or just after the wordmark. */
export const NAV_ALIGNS = ['center', 'start'] as const;
export type NavAlign = (typeof NAV_ALIGNS)[number];
/** Where the floating pill sits, in reading order; start and end mirror in Arabic. */
export const NAV_PLACES = ['top-start', 'top', 'top-end', 'bottom-start', 'bottom', 'bottom-end'] as const;
export type NavPlace = (typeof NAV_PLACES)[number];

export interface NavItemPref {
  id: string;
  /** The person's own name for it; null for Orbit's. */
  label: string | null;
  hidden: boolean;
}

export interface NavLayout {
  position: NavPosition;
  side: NavSide;
  /** For the top bar and the cinematic bar; the other layouts ignore it. */
  align: NavAlign;
  /** For the floating pill; the other layouts ignore it. */
  place: NavPlace;
  items: NavItemPref[];
}

export const NAV_LABEL_MAX = 24;
/** More than Orbit has pages, and few enough to keep a saved layout small. */
const MAX_ITEMS = 24;

export const DEFAULT_NAV_LAYOUT: NavLayout = { position: 'top', side: 'start', align: 'center', place: 'bottom', items: [] };

/** Printable, single-line and short; null when nothing's left. */
export function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = [...value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim()].slice(0, NAV_LABEL_MAX).join('').trim();
  return label || null;
}

const ItemSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,31}$/)),
  label: v.optional(v.unknown()),
  hidden: v.optional(v.boolean(), false),
});

export const NavLayoutSchema = v.object({
  position: v.picklist(NAV_POSITIONS),
  side: v.optional(v.picklist(NAV_SIDES), 'start'),
  // Added later: themes and layouts saved before it have none, and an unknown value (a newer
  // Orbit's) falls back on its own rather than resetting the whole layout.
  align: v.fallback(v.optional(v.picklist(NAV_ALIGNS), 'center'), 'center'),
  // Also added later: a pill saved before it could move stays at the bottom in the middle, where it was.
  place: v.fallback(v.optional(v.picklist(NAV_PLACES), 'bottom'), 'bottom'),
  items: v.optional(v.pipe(v.array(ItemSchema), v.maxLength(MAX_ITEMS)), []),
});

/** A layout from settings or a theme file; anything invalid becomes the top bar. */
export function parseNavLayout(value: unknown): NavLayout {
  const parsed = v.safeParse(NavLayoutSchema, value);
  if (!parsed.success) return { ...DEFAULT_NAV_LAYOUT, items: [] };
  const seen = new Set<string>();
  const items = parsed.output.items.flatMap((item) => {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, label: cleanLabel(item.label), hidden: item.hidden }];
  });
  return { position: parsed.output.position, side: parsed.output.side, align: parsed.output.align, place: parsed.output.place, items };
}

/** Pages the nav leaves out until the person shows them here (the nav is full without them). */
export const HIDDEN_BY_DEFAULT: readonly string[] = ['addons'];

/**
 * The saved items in their order, for the pages Orbit has: ones it no
 * longer has are dropped, and new ones join at the end in Orbit's order
 * (hidden, for the pages in HIDDEN_BY_DEFAULT).
 */
export function arrangeItems(saved: readonly NavItemPref[], ids: readonly string[]): NavItemPref[] {
  const known = saved.filter((item) => ids.includes(item.id));
  const missing = ids.filter((id) => !known.some((item) => item.id === id)).map((id) => ({ id, label: null, hidden: HIDDEN_BY_DEFAULT.includes(id) }));
  return [...known, ...missing];
}

/** Moves the item at `from` by `by` places, staying in the list. */
export function moveItem<T>(items: readonly T[], from: number, by: number): T[] {
  const to = Math.min(items.length - 1, Math.max(0, from + by));
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Dispatched on `document` with the layout when it changes (applied or previewed). */
export const NAV_LAYOUT_CHANGED = 'orbit:nav-layout';

let current: NavLayout = DEFAULT_NAV_LAYOUT;
/** The layout on screen: the current one, or one Theme Studio is previewing. */
let shown: NavLayout = DEFAULT_NAV_LAYOUT;
/** The layout as set (never a preview), which is what the rest of Orbit reads. */
export const currentNavLayout = (): NavLayout => current;
export const shownNavLayout = (): NavLayout => shown;

export function applyNavLayout(layout: NavLayout): void {
  current = layout;
  showNavLayout(layout);
}

/** Puts layout on screen without making it the current one (a preview). */
export function showNavLayout(layout: NavLayout): void {
  shown = layout;
  const root = document.documentElement;
  root.dataset.nav = layout.position;
  root.dataset.navSide = layout.side;
  root.dataset.navAlign = layout.align;
  root.dataset.navPlace = layout.place;
  document.dispatchEvent(new CustomEvent<NavLayout>(NAV_LAYOUT_CHANGED, { detail: layout }));
}
