/**
 * One way to say "nothing here" or "that didn't work": an icon, a short
 * title, one line saying what to do next, and at most one action. Error
 * text is always Orbit's own words (see lib/user-error.ts), set as text,
 * never raw error output, an address or a key.
 *
 * An error with Try again retries by itself when the connection comes back,
 * so a page that failed while offline fills in without a click.
 */
import { AddonFailure, describeAddonError, toAddonError } from '../addons/errors';
import { VIEW_DISCARDED, VIEW_SHOWN } from '../app/router';
import { hasMessage, language, t, type MessageKey } from '../i18n';
import { h } from '../lib/dom';
import { isShown } from '../lib/shown';
import { classifyError, errorCode, playbackFailure, safeSentence, ShownError, type ClassifiedError, type ErrorService } from '../lib/user-error';
import { icon, type IconName } from './icons';

const isAddonError = (err: unknown) => typeof err === 'object' && err !== null && typeof (err as { kind?: unknown }).kind === 'string';
const online = () => typeof navigator === 'undefined' || navigator.onLine;
export const isOffline = () => !online();

export const classify = (err: unknown, service?: ErrorService): ClassifiedError => classifyError(err, service ? { online: online(), service } : { online: online() });

/**
 * Whether a row keeps its own failure box to itself: offline, every row fails the
 * same way and the offline banner under the title bar already says so once, so a
 * page of identical "Couldn't load / Try again" boxes says nothing more. The row
 * stays empty and comes back with the connection (`retryWhenOnline`).
 */
export const rowErrorHidden = (found: ClassifiedError): boolean => found.cause === 'offline';

const AUTH_TEXT: Record<ErrorService, MessageKey> = {
  debrid: 'states.auth.debrid',
  stremio: 'states.auth.stremio',
  tmdb: 'states.auth.tmdb',
  jellyfin: 'states.auth.jellyfin',
  plex: 'states.auth.plex',
  iptv: 'states.auth.iptv',
  anilist: 'states.auth.anilist',
  addon: 'states.auth.addon',
};

/** Where Settings renews each service's sign-in (a category and the part of its page). */
const FIX_PLACE: Record<ErrorService, [string, string?]> = {
  debrid: ['accounts', '.debrid-section'],
  stremio: ['accounts', '.stremio-section'],
  tmdb: ['accounts', '.tmdb-row'],
  jellyfin: ['accounts', '.jellyfin-section'],
  plex: ['accounts', '.plex-section'],
  iptv: ['accounts', '.live-tv-section'],
  anilist: ['accounts', '.anilist-section'],
  addon: ['addons'],
};

/** A coded Rust error in the person's language; null if Orbit has no words for the code. */
export function codedText(err: unknown): string | null {
  const code = errorCode(err);
  if (code?.name === 'pin.locked') {
    // The pause doubles up to an hour (profiles.rs): "3,601 s" is said in minutes.
    const seconds = Number(code.params.seconds);
    if (seconds >= 120) return t('errors.pin.locked-minutes', { minutes: Math.ceil(seconds / 60) });
  }
  const key = code ? `errors.${code.name}` : '';
  if (!code || !hasMessage(key)) return null;
  // Counts are formatted for the language ("1,000", "1 000").
  const vars = Object.fromEntries(Object.entries(code.params).map(([name, value]) => [name, /^\d{1,9}$/.test(value) ? Number(value) : value]));
  return t(key, vars);
}

/**
 * `err` as one line in the person's language. Being offline, or a sign-in to
 * renew, is said the same way everywhere; otherwise a coded Rust error, or a
 * cause Orbit has words for, uses those; a plain English sentence from Orbit
 * itself is kept in English, and anything else becomes `fallback` (or a
 * general line). Offline, the line says the page reloads by itself, unless
 * `action` says it was a one-off action the person has to try again.
 */
export function errorText(err: unknown, options: { service?: ErrorService; fallback?: MessageKey; action?: boolean } = {}): string {
  if (err instanceof ShownError) return err.message;
  const found = classify(err, options.service);
  // `action`: something the person did (a sign-in, saving a key), which nothing retries by itself.
  if (found.cause === 'offline') return t(options.action ? 'states.cause.offline-action' : 'states.cause.offline');
  if (found.cause === 'signed-out' && found.service) return t(AUTH_TEXT[found.service]);
  const coded = codedText(err);
  if (coded) return coded;
  if (found.cause !== 'unknown') return t(`states.cause.${found.cause}` as MessageKey);
  // An addon problem with its own words (https only, another profile's addon…): those are translated already.
  if (err instanceof AddonFailure || isAddonError(err)) return describeAddonError(toAddonError(err));
  const sentence = language() === 'en' ? safeSentence(err) : null;
  return sentence ?? t(options.fallback ?? 'states.cause.unknown');
}

/** Why a source didn't play (mpv's error text, or a failed open), in the person's words. */
export function playbackText(reason: unknown): string {
  const found = classify(reason);
  if (found.cause === 'signed-out' && found.service) return t(AUTH_TEXT[found.service]);
  const coded = codedText(reason);
  if (coded) return coded;
  const failure = playbackFailure(reason, online());
  if (failure === 'offline') return t('states.cause.offline');
  // Orbit's own sentences (a torrent that found no video, say) say more than "stopped working".
  const sentence = failure === 'failed' && language() === 'en' ? safeSentence(reason) : null;
  return sentence ?? t(`states.player.${failure}`);
}

/** "Fix in Settings": opens the part of Settings that renews `service`'s sign-in. */
export function fixButton(service: ErrorService, go: (room: string) => void): HTMLElement {
  const button = h('button', { class: 'button primary' }, t('states.action.fix'));
  button.addEventListener('click', () => openSettings(go, ...FIX_PLACE[service]));
  return button;
}

/** "Connect TMDB", the same everywhere a feature needs it: Settings, at the TMDB row. */
export function connectTmdbButton(go: (room: string) => void): HTMLElement {
  const button = h('button', { class: 'button primary' }, t('search.no-tmdb.open'));
  button.addEventListener('click', () => openSettings(go, ...FIX_PLACE.tmdb));
  return button;
}

function openSettings(go: (room: string) => void, category: string, section?: string): void {
  // Loaded on use: Settings imports components that use this module.
  void import('../rooms/settings').then(({ openSettingsTo }) => {
    openSettingsTo(category, section);
    go('settings');
  });
}

/** The first timed retry, doubling each round after it up to the most. */
const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Timed retry rounds in a row; starts over once none has come for a while (the last one worked). */
let retryRounds = 0;
let lastRound = 0;

function retryDelay(): number {
  // abs: a clock set back doesn't leave retries backed off.
  if (Math.abs(Date.now() - lastRound) > RETRY_MAX_MS * 2) retryRounds = 0;
  return Math.min(RETRY_FIRST_MS * 2 ** retryRounds, RETRY_MAX_MS);
}

function countRound(): void {
  const now = Date.now();
  // A page's failed parts retry together: that's one round, not one each.
  if (now - lastRound > 1000) retryRounds++;
  lastRound = now;
}

/**
 * Calls `retry` once: when the connection returns, or after a while with backoff,
 * whichever comes first. The timer is there because `navigator.onLine` only knows
 * about the local network: with the router up and the internet down it says online,
 * and no `online` event ever comes. It runs only if `owner` is shown then; a
 * kept view off the page or hidden (another page showing) retries when it shows again, unless
 * it's dropped first (see router.ts).
 */
export function retryWhenOnline(owner: Element, retry: () => void): void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    window.removeEventListener('online', fire);
    clearTimeout(timer);
    if (isShown(owner)) return retry();
    // The view the router keeps: its outermost ancestor out of the page, or the one in the outlet
    // when it's kept there hidden (router.ts `keep`).
    let view: Node = owner;
    while (view.parentNode && !(view.parentNode as Partial<Element>).classList?.contains('outlet')) view = view.parentNode;
    const stop = () => {
      view.removeEventListener(VIEW_SHOWN, shown);
      view.removeEventListener(VIEW_DISCARDED, stop);
    };
    const shown = () => {
      stop();
      if (isShown(owner)) retry();
    };
    view.addEventListener(VIEW_SHOWN, shown);
    view.addEventListener(VIEW_DISCARDED, stop);
  };
  window.addEventListener('online', fire);
  const timer = setTimeout(() => {
    countRound();
    fire();
  }, retryDelay());
}

export interface StateOptions {
  icon: IconName;
  title: string;
  /** One line of text, or an element when the line has parts (e.g. one per addon). */
  detail?: string | HTMLElement;
  action?: HTMLElement | null;
  /** 'empty' is an invitation (nothing here yet); 'error' is something that went wrong. */
  tone?: 'empty' | 'error';
}

/** The shared empty / error box (`.grid-message`). */
export function stateMessage(options: StateOptions): HTMLElement {
  return h(
    'div',
    { class: `grid-message state-message${options.tone === 'error' ? '' : ' empty'}`, ...(options.tone === 'error' ? { role: 'alert' } : {}) },
    h('span', { class: 'state-icon' }, icon(options.icon)),
    h('span', { class: 'home-message-title' }, options.title),
    typeof options.detail === 'string' ? h('p', { class: 'muted' }, options.detail) : (options.detail ?? ''),
    options.action ?? '',
  );
}

export interface ErrorStateOptions {
  /** What couldn't happen, e.g. "Couldn't load Popular". Replaced by "You're offline" while offline. */
  title: string;
  err: unknown;
  retry?: () => void;
  /** Needed for "Fix in Settings" on an expired sign-in. */
  go?: (room: string) => void;
  service?: ErrorService;
  fallback?: MessageKey;
}

/** A failure: what happened, what to do, and Try again (or Fix in Settings for a sign-in). */
export function errorState(options: ErrorStateOptions): HTMLElement {
  const found = classify(options.err, options.service);
  const offline = found.cause === 'offline';
  let action: HTMLElement | null = null;
  if (found.cause === 'signed-out' && found.service && options.go) action = fixButton(found.service, options.go);
  else if (options.retry) {
    const retry = options.retry;
    action = h('button', { class: 'button' }, t('browse.search.retry'));
    action.addEventListener('click', retry);
  }
  const box = stateMessage({
    icon: offline ? 'offline' : found.cause === 'signed-out' ? 'lock' : 'info',
    title: offline ? t('states.offline.title') : options.title,
    detail: errorText(options.err, { ...(options.service ? { service: options.service } : {}), ...(options.fallback ? { fallback: options.fallback } : {}) }),
    action,
    tone: 'error',
  });
  // An expired sign-in won't fix itself, so it isn't retried on a timer.
  if (options.retry && found.cause !== 'signed-out') retryWhenOnline(box, options.retry);
  return box;
}
