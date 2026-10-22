/**
 * Reads and saves what first-run setup needs: whether this install is new
 * (rules.ts decides), the onboarded flag, and the "Getting started" card.
 */
import { invoke } from '@tauri-apps/api/core';
import * as registry from '../../addons/registry';
import { settings } from '../../lib/ipc';
import { settleWithin } from '../../lib/timeout';
import { libraryEntries } from '../../library/library';
import { RETURN_TO_KEY, t } from '../../i18n';
import { FIRST_PROFILE, listProfiles, updateProfile } from '../../library/profiles';
import { watchHistory } from '../../library/watch';
import { CHECKLIST_KEY, ONBOARDED_KEY, parseChecklist, type ChecklistState, type SetupSignals } from './rules';

/** sessionStorage: setup was open when the window reloaded (a new language), and in which mode. */
const RESUME_KEY = 'orbit.onboarding';
const READ_MS = 3000;

export type SetupMode = 'first' | 'again';

/** Dispatched on `document` once a first-run setup has ended and been recorded, so Home's card can appear. */
export const ONBOARDING_CLOSED = 'orbit:onboarding-closed';

/** A read that fails or runs late counts as unknown (null), which never shows setup. */
const read = <T>(work: Promise<T>): Promise<T | null> => settleWithin(work.catch(() => null), READ_MS, null);

export async function setupSignals(): Promise<SetupSignals> {
  const [done, addons, profiles, tmdb, stremio] = await Promise.all([
    // Wrapped, so an unset flag ({ value: null }) differs from a failed read (null).
    read(settings.get(ONBOARDED_KEY).then((value) => ({ value }))),
    read(registry.list()),
    read(listProfiles()),
    read(invoke<boolean>('tmdb_token_saved')),
    // Only whether a session is saved: asking Stremio for the account would contact it at every launch.
    read(invoke<boolean>('stremio_signed_in')),
  ]);
  return {
    done: done ? done.value === true : null,
    ownAddons: addons ? addons.filter((addon) => !addon.builtIn).length : null,
    profiles: profiles ? profiles.length : null,
    // Loaded before the first page (main.ts), so these are already in memory.
    history: watchHistory().titles.length,
    library: libraryEntries().length,
    tmdb: tmdb === null ? null : tmdb === true,
    stremio: stremio === null ? null : stremio === true,
  };
}

export const markOnboarded = (): Promise<void> => settings.set(ONBOARDED_KEY, true);

export async function loadChecklist(): Promise<ChecklistState | null> {
  return parseChecklist(await settings.get(CHECKLIST_KEY).catch(() => null));
}

export const saveChecklist = (state: ChecklistState): Promise<void> => settings.set(CHECKLIST_KEY, state);

/** Starts Home's card after a first-run setup; never restarts one that was dismissed or completed. */
export async function startChecklist(): Promise<void> {
  if (await loadChecklist()) return;
  await saveChecklist({ dismissed: false, profilesSeen: false });
}

/**
 * Setup reopens after the reload its language change makes. Run again (from Settings → General), it
 * reopens over that page, as a language changed there does, rather than over Home.
 */
export function rememberResume(mode: SetupMode): void {
  try {
    sessionStorage.setItem(RESUME_KEY, mode);
    if (mode === 'again') sessionStorage.setItem(RETURN_TO_KEY, 'settings-general');
  } catch {
    // Without storage, setup simply doesn't reopen after the reload.
  }
}

export function takeResume(): SetupMode | null {
  try {
    const mode = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return mode === 'first' || mode === 'again' ? mode : null;
  } catch {
    return null;
  }
}

/** sessionStorage: the name setup last gave the first profile, so a language changed during setup renames it again. */
const NAMED_KEY = 'orbit.onboarding.profile-name';

/** Dispatched on `document` with the new name once setup has named the first profile (the title bar shows it). */
export const FIRST_PROFILE_NAMED = 'orbit:first-profile-named';

/**
 * A new install only (first-run setup calls it): Rust names the first profile
 * "Me" in English (db.rs), and here it gets that name in the person's
 * language. A name the person chose is never touched, nor any other profile.
 */
export async function nameFirstProfile(): Promise<void> {
  const profiles = await listProfiles();
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (!only || only.id !== FIRST_PROFILE.id) return;
  let given: string | null = null;
  try {
    given = sessionStorage.getItem(NAMED_KEY);
  } catch {
    // Without storage, only Rust's placeholder is renamed.
  }
  if (only.name !== FIRST_PROFILE.name && only.name !== given) return;
  const name = t('titles.profiles.default-name');
  if (name !== only.name) {
    await updateProfile(only.id, name, only.color, only.avatar);
    document.dispatchEvent(new CustomEvent(FIRST_PROFILE_NAMED, { detail: name }));
  }
  try {
    sessionStorage.setItem(NAMED_KEY, name);
  } catch {
    // As above.
  }
}