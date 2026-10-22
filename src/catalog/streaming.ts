/**
 * Which streaming services' catalogs to show (Settings → Integrations), and
 * the country whose catalogs they are. None are picked until the person picks.
 */
import { invoke } from '@tauri-apps/api/core';
import { locale } from '../i18n';
import { settings } from '../lib/ipc';

const SERVICES_KEY = 'streaming.services';
const REGION_KEY = 'streaming.region';
/** Dispatched on `document` when the picked services or the region change. */
export const STREAMING_CHANGED = 'orbit:streaming-changed';

/** Countries offered in the picker (TMDB's watch regions); the system's own is added if missing. */
const REGIONS = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'AT', 'CH', 'FR', 'BE', 'NL', 'ES', 'PT', 'IT', 'SE', 'NO', 'DK', 'FI', 'PL', 'BR', 'MX', 'AR', 'IN', 'JP', 'KR', 'ZA'];

/** The country Windows is set to, or the US. */
function systemRegion(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && /^[A-Z]{2}$/.test(region) ? region : 'US';
  } catch {
    return 'US';
  }
}

export function regionChoices(): string[] {
  const own = systemRegion();
  return REGIONS.includes(own) ? REGIONS : [own, ...REGIONS];
}

const names = new Intl.DisplayNames([locale()], { type: 'region' });
export const regionName = (code: string) => names.of(code) ?? code;
/** The country's short name where the language has one ("US", "UK"), else its usual name. */
const shortNames = new Intl.DisplayNames([locale()], { type: 'region', style: 'short' });
export const regionShortName = (code: string) => shortNames.of(code) ?? regionName(code);

export async function pickedServices(): Promise<string[]> {
  return parseServices(await settings.get(SERVICES_KEY).catch(() => null));
}

export async function streamingRegion(): Promise<string> {
  return parseRegion(await settings.get(REGION_KEY).catch(() => null)) ?? systemRegion();
}

/** Saved service keys, keeping only short lowercase names (Rust checks them against its list too). */
export function parseServices(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && /^[a-z]{1,20}$/.test(v)) : [];
}

/** A saved two-letter country code, or null. */
export function parseRegion(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null;
}

async function save(key: string, value: unknown): Promise<void> {
  await settings.set(key, value);
  document.dispatchEvent(new Event(STREAMING_CHANGED));
}

export const setPickedServices = (keys: string[]) => save(SERVICES_KEY, keys);

/**
 * Saved by Rust, not as a plain setting: a content limit reads ratings in the
 * region's terms, so on a limited profile changing it needs a parent's PIN
 * (rejected with `parent-pin-needed` without one).
 */
export async function setStreamingRegion(code: string, guardianPin?: string): Promise<void> {
  await invoke('tmdb_set_region', { region: code, guardianPin: guardianPin ?? null });
  document.dispatchEvent(new Event(STREAMING_CHANGED));
}
