/**
 * Whether each addon answered its latest request (catalogs, titles, sources,
 * subtitles, a manifest refresh), for the "Didn't answer" mark on the Addons
 * page. Every addon request goes through registry.ts, which notes the
 * outcome here: in memory for this session, nothing saved, and listeners
 * hear only when an addon's state flips (not on every request), batched.
 */
import type { AddonError } from './types';

export interface AddonHealth {
  /** Whether its latest request got an answer. */
  answered: boolean;
  /** Why not, when it didn't. */
  error: AddonError | null;
  at: number;
}

const latest = new Map<string, AddonHealth>();
const listeners = new Set<() => void>();
let queued = false;

/**
 * Whether `error` means the addon didn't answer (or answered with something
 * broken): a timeout, no connection, a server error, an oversized or invalid
 * reply. A 4xx is an answer ("not here"), and so is being busy; errors made
 * on this side (no link stored, a linked list) say nothing about the addon.
 */
export function isNoAnswer(error: AddonError): boolean {
  switch (error.kind) {
    case 'timeout':
    case 'network':
    case 'too-large':
    case 'invalid-response':
      return true;
    case 'http':
      return error.status >= 500;
    default:
      return false;
  }
}

/** Notes how an addon's request ended: `error` null when it answered. */
export function noteAnswer(key: string, error: AddonError | null, now = Date.now()): void {
  const answered = error === null || !isNoAnswer(error);
  const before = latest.get(key);
  latest.set(key, { answered, error: answered ? null : error, at: now });
  if (before ? before.answered === answered : answered) return;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const listener of listeners) listener();
  });
}

/** The addon's latest outcome, or null before it was asked anything this session. */
export const addonHealth = (key: string): AddonHealth | null => latest.get(key) ?? null;

/** Calls `listener` when an addon starts or stops answering; returns an unsubscribe function. */
export function onHealthChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests. */
export function resetHealth(): void {
  latest.clear();
}
