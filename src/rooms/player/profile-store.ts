/**
 * A small value saved per profile (one settings key each, e.g.
 * "player.track-memory.<profile id>"), read once and kept in memory.
 * Switching profile reloads the window, so the key can't change under it.
 */
import { settings } from '../../lib/ipc';
import { historyPaused } from '../../library/history-pause';
import { activeProfileId } from '../../library/profiles';

/** Setting keys allow lowercase letters, digits and ._- (64 at most). */
const PROFILE_ID = /^[a-z0-9._-]{1,40}$/;

export function profileStore<T>(prefix: string, parse: (value: unknown) => T) {
  let key: string | null = null;
  let value = parse(undefined);
  let loading: Promise<void> | undefined;

  const load = (): Promise<void> =>
    (loading ??= (async () => {
      const id = await activeProfileId().catch(() => null);
      key = id && PROFILE_ID.test(id) ? `${prefix}.${id}` : null;
      if (key) value = parse(await settings.get(key).catch(() => undefined));
    })());

  function update(change: (current: T) => T): Promise<void> {
    return load().then(() => {
      value = change(value);
      if (key) return settings.set(key, value).catch((err: unknown) => console.warn('Could not save', prefix, err));
    });
  }

  return {
    load,
    /** The value as last loaded or changed (the default until loaded). */
    get: () => value,
    /** Changes the value once loaded, and saves it. */
    update,
    /**
     * Like `update`, for what playing notes on its own about a title (its
     * last source, a failed source, the audio and subtitles picked for it):
     * skipped while watch history is paused, so pausing leaves no trace of
     * what played. Forgetting by hand still goes through `update`.
     */
    record(change: (current: T) => T): Promise<void> {
      return historyPaused() ? Promise.resolve() : update(change);
    },
  };
}
