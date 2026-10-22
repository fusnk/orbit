import type * as v from 'valibot';
import type { CatalogResponseSchema, ManifestSchema, MetaResponseSchema, StreamResponseSchema, SubtitlesResponseSchema } from './schema';

// Protocol types are inferred from the schemas so they can't drift apart.
export type Manifest = v.InferOutput<typeof ManifestSchema>;
export type ManifestCatalog = Manifest['catalogs'][number];
export type MetaPreview = v.InferOutput<typeof CatalogResponseSchema>['metas'][number];
export type MetaDetail = NonNullable<v.InferOutput<typeof MetaResponseSchema>['meta']>;
export type Video = NonNullable<MetaDetail['videos']>[number];
export type Stream = v.InferOutput<typeof StreamResponseSchema>['streams'][number];
export type Subtitle = v.InferOutput<typeof SubtitlesResponseSchema>['subtitles'][number];

export type ResourceName = 'catalog' | 'meta' | 'stream' | 'subtitles' | 'addon_catalog';

/** An installed addon. The transport URL never leaves Rust; `key` stands in for it. */
export interface InstalledAddon {
  key: string;
  /** `null` when the stored manifest no longer passes validation. */
  manifest: Manifest | null;
  displayHost: string;
  enabled: boolean;
  installedAt: number;
  /** `false` when the stored URL can't be decrypted; the addon must be reinstalled. */
  urlReadable: boolean;
  /** Installed by Orbit (Cinemeta): can be disabled, not removed. */
  builtIn: boolean;
  /** Installed by the active profile, which can share or delete it. */
  owned: boolean;
  /** Shared with the other profiles. */
  shared: boolean;
  /** The profile that shared it, when that isn't the active one. */
  sharedBy: string | null;
}

export type UsableAddon = InstalledAddon & { manifest: Manifest };

/** Ordered extra arguments, e.g. `[['search', 'dune'], ['skip', '100']]`. */
export type ExtraArgs = readonly (readonly [name: string, value: string])[];

export interface ResourceRequest {
  resource: ResourceName;
  type: string;
  id: string;
  extra?: ExtraArgs;
}

/** Mirrors `AddonError` in src-tauri/src/addons/mod.rs, plus client-side validation errors. */
export type AddonError =
  | { kind: 'invalid-url'; reason: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'timeout' }
  | { kind: 'http'; status: number }
  | { kind: 'rate-limited'; retryAfterSecs: number | null }
  | { kind: 'too-large'; limitBytes: number }
  | { kind: 'invalid-response'; issues: string[] }
  | { kind: 'network'; message: string }
  | { kind: 'not-found' }
  | { kind: 'reinstall-needed' }
  | { kind: 'built-in' }
  | { kind: 'not-owner' }
  | { kind: 'linked'; owner: string }
  | { kind: 'storage'; message: string };

export interface AddonOrigin {
  key: string;
  name: string;
}

/** A deduplicated item and every addon that returned it, in the user's addon order. */
export interface Sourced<T> {
  item: T;
  origins: AddonOrigin[];
}

export type AggregateEvent<T> =
  | { type: 'partial'; origin: AddonOrigin; items: Sourced<T>[] }
  | { type: 'error'; origin: AddonOrigin; error: AddonError }
  | { type: 'done'; succeeded: number; failed: number };
