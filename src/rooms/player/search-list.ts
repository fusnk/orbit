/**
 * The source search's list (see source-search.ts): which addons show in
 * what order, which one is centred, and how far the others fade.
 */
import type { AddonOrigin, AggregateEvent, Stream } from '../../addons/types';

export type AddonState = { key: string; name: string } & ({ state: 'asking' } | { state: 'found'; count: number } | { state: 'empty' } | { state: 'failed' });

/**
 * The list as it should show: addons that answered first, in the order they
 * did, then those still being asked, in the person's order; and which one is
 * centred (the first still being asked, or the last once all have answered).
 */
export function searchList(addons: readonly AddonOrigin[], answered: ReadonlyMap<string, AddonState>): { rows: AddonState[]; active: number } {
  const done = [...answered.values()];
  const waiting = addons.filter((a) => !answered.has(a.key)).map((a): AddonState => ({ key: a.key, name: a.name, state: 'asking' }));
  const rows = [...done, ...waiting];
  return { rows, active: waiting.length ? done.length : Math.max(0, rows.length - 1) };
}

/** How many sources an addon contributed, from a merged partial result. */
export function sourcesFrom(event: Extract<AggregateEvent<Stream>, { type: 'partial' }>): number {
  return event.items.filter((s) => s.origins.some((o) => o.key === event.origin.key)).length;
}

/** How a row looks at `distance` rows from the centre. */
export const fadeFor = (distance: number) => Math.max(0.12, 1 - Math.abs(distance) * 0.3);
