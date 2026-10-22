import { toAddonError } from './errors';
import { request } from './registry';
import { isEligible } from './routing';
import type { AddonError, AddonOrigin, AggregateEvent, InstalledAddon, ResourceRequest, Sourced, UsableAddon } from './types';

type Outcome<T> =
  | { addon: UsableAddon; ok: true; items: T[] }
  | { addon: UsableAddon; ok: false; error: AddonError };

const originOf = (addon: UsableAddon): AddonOrigin => ({ key: addon.key, name: addon.manifest.name });

/**
 * Queries every eligible addon in parallel and yields a merged snapshot each
 * time one responds, so the UI can render partial results immediately.
 * Items are deduplicated by `keyOf`; the first addon in the user's order that
 * returned an item supplies it, and all addons that returned it are listed.
 * Per-addon timeouts and size caps are enforced in Rust.
 */
export async function* aggregate<T>(
  addons: readonly InstalledAddon[],
  req: ResourceRequest,
  parse: (json: unknown) => T[],
  keyOf: (item: T) => string,
  signal: AbortSignal,
): AsyncGenerator<AggregateEvent<T>> {
  const eligible = addons.filter((addon) => isEligible(addon, req));
  const results = new Map<string, T[]>();

  const settle = async (addon: UsableAddon): Promise<Outcome<T>> => {
    try {
      return { addon, ok: true, items: parse(await request(addon, req)) };
    } catch (err) {
      return { addon, ok: false, error: toAddonError(err) };
    }
  };
  const pending = new Map(eligible.map((addon) => [addon.key, settle(addon)]));

  let succeeded = 0;
  let failed = 0;
  while (pending.size > 0) {
    const outcome = await Promise.race(pending.values());
    pending.delete(outcome.addon.key);
    if (signal.aborted) return;

    if (outcome.ok) {
      succeeded++;
      results.set(outcome.addon.key, outcome.items);
      yield { type: 'partial', origin: originOf(outcome.addon), items: merge(eligible, results, keyOf) };
    } else {
      failed++;
      yield { type: 'error', origin: originOf(outcome.addon), error: outcome.error };
    }
  }
  yield { type: 'done', succeeded, failed };
}

function merge<T>(addons: UsableAddon[], results: Map<string, T[]>, keyOf: (item: T) => string): Sourced<T>[] {
  const merged = new Map<string, Sourced<T>>();
  for (const addon of addons) {
    const items = results.get(addon.key);
    if (!items) continue;
    const origin = originOf(addon);
    for (const item of items) {
      const key = keyOf(item);
      const existing = merged.get(key);
      if (!existing) merged.set(key, { item, origins: [origin] });
      else if (!existing.origins.some((o) => o.key === origin.key)) existing.origins.push(origin);
    }
  }
  return [...merged.values()];
}
