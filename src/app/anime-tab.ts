/** The optional Anime tab (Settings → Library & Metadata), hidden unless turned on. */
import { settings } from '../lib/ipc';

const KEY = 'nav.anime';
/** Dispatched on `document` with the new value when the setting changes. */
export const ANIME_TAB_CHANGED = 'orbit:anime-tab';

export async function animeTabShown(): Promise<boolean> {
  return (await settings.get(KEY).catch(() => false)) === true;
}

export async function setAnimeTabShown(on: boolean): Promise<void> {
  await settings.set(KEY, on);
  document.dispatchEvent(new CustomEvent<boolean>(ANIME_TAB_CHANGED, { detail: on }));
}
