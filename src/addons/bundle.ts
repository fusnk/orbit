/**
 * Addon bundles: a small JSON list of addons to hand to someone else.
 *
 * Rust writes them (see src-tauri/src/addons/bundle.rs) and only ever puts a
 * plain, unconfigured install URL in one; anything with settings travels as
 * its host plus "needs setup". A bundle someone sends you is untrusted input,
 * so it's validated here with tight caps, and an entry only becomes an addon
 * through the normal install path (manifest fetch, schema, review, confirm).
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { withDialog } from '../lib/ipc';
import { fetchLinkedManifest } from './registry';

/** Must match `BUNDLE_FORMAT` in bundle.rs. */
export const BUNDLE_FORMAT = 1;
/** A real bundle is a few KB; anything far larger isn't one. */
export const MAX_BUNDLE_CHARS = 64 * 1024;
/** Must match `MAX_BUNDLE_ADDONS` in bundle.rs. */
export const MAX_BUNDLE_ADDONS = 100;

export type BundleEntry =
  | { kind: 'install'; name: string; id: string; version: string | undefined; url: string }
  | { kind: 'setup'; name: string; id: string; version: string | undefined; host: string | null };

export interface Bundle {
  entries: BundleEntry[];
  /** Entries that couldn't be read (or repeated an addon) and were left out. */
  skipped: number;
}

export class BundleError extends Error {
  constructor(readonly reason: 'too-large' | 'not-a-bundle' | 'newer' | 'empty') {
    super(reason);
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const label = (max: number) => v.pipe(v.string(), v.transform((s) => s.replace(CONTROL_CHARS, '').trim().slice(0, max)), v.minLength(1));

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A public DNS name (with an optional port), as `host` from a URL. IP
 * literals and `localhost` are refused: a bundle comes from someone else, and
 * must never point Orbit at this machine or the local network.
 */
export function publicHost(host: string): boolean {
  let url: URL;
  try {
    url = new URL(`https://${host}/`);
  } catch {
    return false;
  }
  const name = url.hostname.toLowerCase();
  return (
    url.host === host.toLowerCase() &&
    name.includes('.') &&
    !name.startsWith('[') &&
    !IPV4.test(name) &&
    name !== 'localhost' &&
    !name.endsWith('.localhost')
  );
}

/** A plain install URL: https, a public host, exactly `/manifest.json`, nothing else. */
export function plainInstallUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const plain = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/manifest.json' && publicHost(url.host);
  return plain ? `https://${url.host}/manifest.json` : null;
}

const common = {
  name: label(100),
  id: label(512),
  version: v.fallback(v.optional(v.pipe(v.string(), v.maxLength(64), v.regex(/^\d+\.\d+\.\d+/))), undefined),
};

const EntrySchema = v.union([
  v.pipe(
    v.object({ ...common, url: v.pipe(v.string(), v.maxLength(2048)) }),
    v.check((e) => plainInstallUrl(e.url) !== null),
    v.transform((e): BundleEntry => ({ kind: 'install', name: e.name, id: e.id, version: e.version, url: plainInstallUrl(e.url)! })),
  ),
  v.pipe(
    v.object({ ...common, needsSetup: v.literal(true), host: v.fallback(v.optional(v.pipe(v.string(), v.maxLength(260))), undefined) }),
    // A host that isn't public is kept out (no link is offered), but the entry stays.
    v.transform((e): BundleEntry => ({ kind: 'setup', name: e.name, id: e.id, version: e.version, host: e.host && publicHost(e.host) ? e.host.toLowerCase() : null })),
  ),
]);

const BundleSchema = v.object({
  orbitAddons: v.pipe(v.number(), v.integer(), v.minValue(1)),
  addons: v.pipe(v.array(v.unknown()), v.maxLength(MAX_BUNDLE_ADDONS)),
});

/** Reads a bundle (a file's text or pasted text). Throws `BundleError`. */
export function parseBundle(text: string): Bundle {
  if (text.length > MAX_BUNDLE_CHARS) throw new BundleError('too-large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BundleError('not-a-bundle');
  }
  const parsed = v.safeParse(BundleSchema, json);
  if (!parsed.success) {
    const addons: unknown = (json as { addons?: unknown } | null)?.addons;
    throw new BundleError(Array.isArray(addons) && addons.length > MAX_BUNDLE_ADDONS ? 'too-large' : 'not-a-bundle');
  }
  if (parsed.output.orbitAddons > BUNDLE_FORMAT) throw new BundleError('newer');
  const entries: BundleEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of parsed.output.addons) {
    const entry = v.safeParse(EntrySchema, raw);
    if (!entry.success || seen.has(entry.output.id)) {
      skipped++;
      continue;
    }
    seen.add(entry.output.id);
    entries.push(entry.output);
  }
  if (!entries.length) throw new BundleError('empty');
  return { entries, skipped };
}

/**
 * An install entry's manifest, or null when its address leads to this machine or the home
 * network. `publicHost` only reads the name's text, and a public-looking name can resolve into
 * the LAN (`192-168-1-1.nip.io`); fetching it as an address the person gave would let a bundle
 * from someone else reach their router or a local service. So it's fetched as an unconfirmed
 * install link, which Rust refuses to contact there.
 */
export const bundleManifest = (url: string) => fetchLinkedManifest(url);

/** The active profile's addons as bundle text, made by Rust (no configured URL is ever in it). */
export const bundleText = () => invoke<string>('addon_bundle_text');
/** Saves the bundle where the person picks (Downloads suggested); returns where, or `null` if cancelled. */
export const saveBundle = () => withDialog('addon_bundle_save');
