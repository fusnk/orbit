/**
 * Profiles ("Who's watching?"). The active profile lives in Rust, which
 * scopes My Library, watch history and addons to it; this module wraps the
 * commands and decides what happens at startup.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { forgetList } from '../addons/registry';
import { LEVELS, type ContentLimit } from '../catalog/ratings';
import { locale, t } from '../i18n';
import { settings } from '../lib/ipc';

export interface Profile {
  id: string;
  name: string;
  /** "#rrggbb", the avatar colour. */
  color: string;
  /** A bundled picture's name (see avatars.ts), or null for the coloured initial. */
  avatar: string | null;
  /** The profile whose addon list this one uses (read-only), or null for its own. */
  addonsFrom: string | null;
  hasPin: boolean;
  /** What this profile may see (catalog/ratings.ts); only Rust changes it, see `setContentLimit`. */
  contentLimit: ContentLimit;
}

/** Avatar colours on offer: the accent presets plus two more. */
export const PROFILE_COLORS = ['#e5484d', '#f5a524', '#3e9bff', '#46c28e', '#a46bf5', '#ec6aa8'] as const;

const ProfileSchema = v.object({
  id: v.string(),
  name: v.string(),
  color: v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i)),
  avatar: v.fallback(v.nullable(v.string()), null),
  addonsFrom: v.fallback(v.nullable(v.string()), null),
  hasPin: v.boolean(),
  // A limit that can't be read is the strictest one, not none.
  contentLimit: v.fallback(v.object({ level: v.picklist(LEVELS), allowUnrated: v.boolean(), allowLiveTv: v.boolean() }), { level: 'kids', allowUnrated: false, allowLiveTv: false }),
});

export async function listProfiles(): Promise<Profile[]> {
  return v.parse(v.array(ProfileSchema), await invoke('profile_list'));
}

/**
 * The active profile's id, asked of Rust once it's known: it changes only by
 * `selectProfile` (at startup, or before the window reloads on a switch).
 * "None yet" isn't kept, so the startup choice is picked up.
 */
let active: Promise<string | null> | null = null;

export function activeProfileId(): Promise<string | null> {
  if (!active) {
    const current = invoke<string | null>('profile_active');
    const forget = () => {
      if (active === current) active = null;
    };
    current.then((id) => id === null && forget(), forget);
    active = current;
  }
  return active;
}

/**
 * A setting kept per profile as `{prefix}.{profile id}` (listed in
 * profiles.rs `PROFILE_SETTINGS`): its key and value. A value saved before
 * the setting was per profile moves to the first profile that reads it.
 */
export async function profileSetting(prefix: string): Promise<{ key: string; value: unknown }> {
  const id = await activeProfileId().catch(() => null);
  // Setting keys allow lowercase letters, digits and ._- only.
  if (!id || !/^[a-z0-9._-]{1,40}$/.test(id)) return { key: prefix, value: await settings.get(prefix).catch(() => null) };
  const key = `${prefix}.${id}`;
  const value = await settings.get(key).catch(() => null);
  if (value !== null && value !== undefined) return { key, value };
  const legacy = await settings.get(prefix).catch(() => null);
  if (legacy === null || legacy === undefined) return { key, value };
  await settings
    .set(key, legacy)
    .then(() => settings.set(prefix, null))
    .catch((err: unknown) => console.warn('Could not move', prefix, 'to the profile', err));
  return { key, value: legacy };
}

const LAST_KEY = 'profiles.last';
/** The profile picked last time, which "Who's watching?" starts on. */
export async function lastProfileId(): Promise<string | null> {
  const id = await settings.get(LAST_KEY).catch(() => null);
  return typeof id === 'string' ? id : null;
}

/** Rejects with a code (`err.pin.wrong`, `err.pin.locked`…) when the PIN doesn't match. */
export async function selectProfile(id: string, pin?: string): Promise<void> {
  active = null;
  forgetList();
  await invoke<void>('profile_select', { id, pin: pin ?? null }).finally(() => {
    active = null;
    forgetList();
  });
  await settings.set(LAST_KEY, id).catch((err: unknown) => console.warn('Could not remember the profile', err));
}
/** While a profile has a content limit, adding one needs a parent's PIN (unless a parent is the active profile). */
export const createProfile = (name: string, color: string, avatar: string | null, guardianPin?: string) =>
  invoke<Profile>('profile_create', { name, color, avatar, guardianPin: guardianPin ?? null });
/**
 * Sets a profile's content limit. Loosening or removing one needs a parent: a
 * profile without a limit that has a PIN, by being the active profile or by
 * `guardianPin` (see profiles.rs). Rejects with `PARENT_PIN_NEEDED` otherwise.
 */
export const setContentLimit = (id: string, limit: ContentLimit, guardianPin?: string) => invoke<void>('profile_set_limit', { id, limit, guardianPin: guardianPin ?? null });
/** The error profiles.rs answers with when a parent's PIN is needed. */
export const PARENT_PIN_NEEDED = 'parent-pin-needed';
export const updateProfile = (id: string, name: string, color: string, avatar: string | null) => invoke<void>('profile_update', { id, name, color, avatar });
/** Makes `id` use `from`'s addon list, or (with null) its own again. Needs `from`'s PIN if it has one. */
export const setAddonsFrom = (id: string, from: string | null) => invoke<void>('profile_set_addons_from', { id, from }).finally(forgetList);
/** Sets or (with null) removes the active profile's PIN. */
export const setProfilePin = (pin: string | null) => invoke<void>('profile_set_pin', { pin });
/**
 * Deleting a profile also takes its shared addons off the others' lists. A
 * profile with a content limit needs a parent, like loosening its limit:
 * rejects with `PARENT_PIN_NEEDED` unless one is active or `guardianPin` is given.
 */
export const deleteProfile = (id: string, guardianPin?: string) =>
  invoke<void>('profile_delete', { id, guardianPin: guardianPin ?? null }).finally(() => {
    active = null;
    forgetList();
  });

/** What Rust names the first profile on a new install (db.rs): a placeholder, in English, not a name anyone chose. */
export const FIRST_PROFILE = { id: 'main', name: 'Me' } as const;

/**
 * The name the person gave the profile, for a greeting; null for the first
 * profile's placeholder ("Good evening, Me"), or the name first-run setup gave
 * it in their language (onboarding/state.ts).
 */
export function chosenName(profile: Pick<Profile, 'id' | 'name'>): string | null {
  const name = profile.name.trim();
  const placeholder = profile.id === FIRST_PROFILE.id && (name === FIRST_PROFILE.name || name === t('titles.profiles.default-name'));
  return name && !placeholder ? name : null;
}

/** The first letter of a name, for avatars. */
export function initial(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase(locale()) ?? '?';
}

/**
 * Picks the profile at startup when no choice is needed: one already active
 * (the window was reloaded after switching), or a single profile without a
 * PIN. Otherwise the caller shows "Who's watching?".
 */
export async function startProfile(): Promise<'ready' | 'choose'> {
  if (await activeProfileId()) return 'ready';
  const profiles = await listProfiles();
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only && !only.hasPin) {
    await selectProfile(only.id);
    return 'ready';
  }
  return 'choose';
}
