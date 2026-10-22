/**
 * RPDB posters (Settings → Appearance → Posters → Poster provider), for
 * people with an RPDB key. RPDB wants the key in the image's address, so the
 * page never builds or sees that address: it asks Rust's `rpdb-art`
 * protocol for `{style}_{imdb id}` and Rust fetches the poster with the key
 * (src-tauri/src/rpdb.rs). The page can save or remove the key, and learn
 * whether one is saved, but never read it.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appearance } from '../theme/appearance';
import type { Title } from './titles';

const PROTOCOL = 'rpdb-art';
let saved = false;

/** Reads once at start-up whether a key is saved. */
export async function loadRpdb(): Promise<void> {
  saved = await invoke<boolean>('rpdb_key_saved').catch(() => false);
}

export const rpdbKeySaved = (): boolean => saved;

/** Saves the key once RPDB accepts it. Rejects with a code (`rpdb.refused`, `rpdb.key-format`…). */
export async function setRpdbKey(key: string): Promise<void> {
  await invoke('rpdb_set_key', { key });
  saved = true;
}

export async function clearRpdbKey(): Promise<void> {
  await invoke('rpdb_clear_key');
  saved = false;
}

/** The poster to ask RPDB for, when RPDB is the provider, a key is saved and the title has an IMDb id. */
export function rpdbPoster(title: Pick<Title, 'id'>): string | undefined {
  const a = appearance();
  if (a.posterProvider !== 'rpdb' || !saved || !/^tt\d{1,10}$/.test(title.id)) return undefined;
  return convertFileSrc(`${a.rpdbStyle}_${title.id}`, PROTOCOL);
}
