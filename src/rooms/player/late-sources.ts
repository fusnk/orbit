/**
 * Sources that arrive after playback started. An automatic pick only waits a
 * moment for slow addons (see lib/autoplay.ts); once every addon has answered,
 * the player's Source list takes the full ranked list instead.
 */
import type { PlayableSource } from './panels';

const key = (s: PlayableSource) => `${s.addon}\n${s.url}`;

/**
 * The full list `all`, ranked as it came, with the playing source kept as is
 * (failover and the Source panel know it by id) and anything only the earlier
 * list had kept at the end. Ids are made new for the rest, since each round
 * numbers its sources from the start.
 */
export function mergeLateSources(current: PlayableSource, had: readonly PlayableSource[], all: readonly PlayableSource[]): PlayableSource[] {
  // The playing source by its address now, and as listed (picking another
  // file of a torrent changes its address but keeps its id).
  const currentKeys = new Set([key(current), ...had.filter((s) => s.id === current.id).map(key)]);
  const seen = new Set<string>();
  const merged: PlayableSource[] = [];
  let n = 0;
  let placed = false;
  for (const source of [...all, ...had]) {
    const k = key(source);
    if (seen.has(k)) continue;
    seen.add(k);
    if (currentKeys.has(k)) {
      if (!placed) merged.push(current);
      placed = true;
    } else {
      merged.push({ ...source, id: `late-${++n}` });
    }
  }
  if (!placed) merged.push(current);
  return merged;
}
