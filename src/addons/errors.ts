import { t, type MessageKey } from '../i18n';
import type { AddonError } from './types';

export class AddonFailure extends Error {
  readonly error: AddonError;

  constructor(error: AddonError) {
    super(describeAddonError(error));
    this.name = 'AddonFailure';
    this.error = error;
  }
}

/** Normalizes anything thrown by an addon call (IPC rejection or AddonFailure). */
export function toAddonError(err: unknown): AddonError {
  if (err instanceof AddonFailure) return err.error;
  if (typeof err === 'object' && err !== null && typeof (err as { kind?: unknown }).kind === 'string') {
    return err as AddonError;
  }
  return { kind: 'network', message: String(err) };
}

/**
 * Why Rust refused an address: a code (addons/mod.rs `AddonError::InvalidUrl`), in words for each
 * language. Rust sends no text of its own to show; an unknown code gets the general sentence.
 */
const URL_REASONS: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['not-url', 'integrations.errors.url-not-address'],
  ['manifest-path', 'integrations.errors.url-not-manifest'],
  ['credentials', 'integrations.errors.url-sign-in'],
  ['query', 'integrations.errors.url-query'],
  ['resource-path', 'integrations.errors.url-resource'],
  ['token', 'integrations.errors.url-token'],
]);

export function describeAddonError(error: AddonError): string {
  switch (error.kind) {
    case 'invalid-url':
      return t(URL_REASONS.get(error.reason) ?? 'integrations.errors.invalid-url');
    case 'blocked':
      return error.reason === 'redirect'
        ? t('integrations.errors.redirect')
        : t('integrations.errors.https-only');
    case 'timeout':
      return t('integrations.errors.timeout');
    case 'http':
      return t('integrations.errors.http', { status: String(error.status) });
    case 'rate-limited':
      return t('states.cause.busy');
    case 'too-large':
      return t('integrations.errors.too-large', { kb: Math.round(error.limitBytes / 1024) });
    case 'invalid-response':
      // The issues (a schema path, "not valid JSON") are English and technical: they're for tests and logs.
      return t('integrations.errors.invalid-response');
    case 'network':
      // The network library's own text is English and technical; say what to do instead.
      return t(typeof navigator !== 'undefined' && !navigator.onLine ? 'states.cause.offline' : 'states.cause.unreachable');
    case 'not-found':
      return t('integrations.errors.not-found');
    case 'reinstall-needed':
      return t('integrations.errors.reinstall-needed');
    case 'built-in':
      return t('integrations.errors.built-in');
    case 'not-owner':
      return t('integrations.errors.not-owner');
    case 'linked':
      return t('integrations.errors.linked', { owner: error.owner });
    case 'storage':
      return t('states.cause.storage');
  }
}

/**
 * Why an addon's manifest couldn't be loaded for installing it: as `describeAddonError`, but said for
 * an address the person just gave. Nothing tries again by itself, a 404 means there's no addon there
 * (not a passing problem), and anything that isn't a manifest is most likely not an install link.
 */
export function describeManifestError(error: AddonError): string {
  if (error.kind === 'network' && typeof navigator !== 'undefined' && !navigator.onLine) return t('integrations.errors.offline');
  if (error.kind === 'http' && (error.status === 404 || error.status === 410)) return t('integrations.errors.manifest-missing');
  if (error.kind === 'invalid-response') return t('integrations.errors.not-an-addon');
  return describeAddonError(error);
}
