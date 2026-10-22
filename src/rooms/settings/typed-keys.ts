/**
 * Key fields (TMDB, debrid) and how to save what's typed in each, so first-run
 * setup's Finish can save a key typed but not saved yet rather than drop it.
 */
const saves = new WeakMap<HTMLInputElement, () => Promise<boolean>>();

/** `save` saves what's typed in `field`, resolving true once it's saved (false: it says why beside the field). */
export function keyField(field: HTMLInputElement, save: () => Promise<boolean>): void {
  saves.set(field, save);
}

/** Saves every key typed but not saved under `root`; true once all were saved (or there were none). */
export async function saveTypedKeys(root: HTMLElement): Promise<boolean> {
  const typed = [...root.querySelectorAll('input')].filter((field) => field.value.trim() && saves.has(field));
  const saved = await Promise.all(typed.map((field) => saves.get(field)!()));
  return saved.every(Boolean);
}
