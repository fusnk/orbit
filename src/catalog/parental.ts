/**
 * The active profile's content limit (Settings: the profile editor), applied
 * to what the page shows. Ratings come from TMDB through Rust (cached there
 * for weeks, here for the session); addon metas don't carry them reliably.
 *
 * Lookups never hold a page up for long: callers that can wait a moment
 * (rows before they're drawn, a title page) wait a few seconds at most, and
 * anything still unknown counts as blocked until its rating arrives. Cards
 * (see `guardCard`) stay hidden until their title's rating is known, so
 * nothing a limit hides ever shows, even briefly.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { isShown } from '../lib/shown';
import { settleWithin } from '../lib/timeout';
import { activeProfileId, listProfiles } from '../library/profiles';
import { allows, limitFor, NO_LIMIT, serverCertificationBand, shownCertification, titleBand, type Band, type ContentLimit } from './ratings';
import { streamingRegion } from './streaming';
import type { Title } from './titles';

type Rated = Pick<Title, 'id' | 'type'>;

/** Titles per lookup (Rust accepts up to 50). */
const BATCH = 40;
/** How long rows wait for ratings before they're drawn. */
export const ROW_WAIT_MS = 3000;
/** How long a list (`shownNow`) waits for its entries' ratings before drawing again with what's known. */
const LIST_WAIT_MS = 30_000;

let limit: ContentLimit = NO_LIMIT;
let loading: Promise<void> | null = null;
let loaded = false;
/** The country whose certifications are read first (then the US's). */
let region = 'US';
/** Whether ratings can be looked up at all (a TMDB token is saved). */
let tmdb = false;

/**
 * Reads the active profile's limit, once per window (switching profiles
 * reloads it). If the profiles can't be read, the strictest limit applies
 * until the next start: failing closed is safer than showing everything.
 */
export function loadContentLimit(): Promise<void> {
  loading ??= (async () => {
    try {
      const [profiles, id] = await Promise.all([listProfiles(), activeProfileId()]);
      limit = profiles.find((p) => p.id === id)?.contentLimit ?? NO_LIMIT;
    } catch (err) {
      console.warn('Could not read the profile’s content limit', err);
      limit = limitFor('kids');
    }
    if (limit.level !== 'off') await loadLookups();
  })().finally(() => {
    loaded = true;
    const cards = early;
    early = [];
    cards.forEach(applyCard);
  });
  return loading;
}

let lookups: Promise<void> | null = null;

/** The region and whether TMDB can be asked, read once: for the limit, or for the age-rating badges. */
function loadLookups(): Promise<void> {
  // A keychain that can't be read (locked) doesn't mean "no token": taken as none, every title would count as
  // unrated and a profile allowing unrated ones would show anything. Looked up instead, they fail and stay blocked until it can.
  lookups ??= Promise.all([streamingRegion(), invoke<boolean>('tmdb_token_saved').catch(() => true)]).then(([r, saved]) => {
    region = r;
    tmdb = saved;
  });
  return lookups;
}

/** The active profile's limit (no limit until it has been read). */
export const contentLimit = (): ContentLimit => limit;
export const limited = () => limit.level !== 'off';
/** Whether ratings can be found at all: without TMDB every title counts as unrated. */
export const ratingsAvailable = () => tmdb;
/** Live TV (channels carry no ratings) on this profile. */
export const liveTvAllowed = () => limit.level === 'off' || limit.allowLiveTv;

const bands = new Map<string, Band | null>();
/** The certification each band was read from, for "Rated R" on the blocked page. */
const certifications = new Map<string, string>();
/** Titles TMDB flags as adult. */
const adult = new Set<string>();
const pending = new Map<string, { promise: Promise<void>; resolve: () => void }>();
/** When a title's lookup last failed (offline, rate limited), so it counts as blocked until it can be retried. */
const failed = new Map<string, number>();
/** How long a failed lookup keeps its title blocked before asking again. */
const RETRY_MS = 30_000;
const lookupFailed = (id: string) => {
  const at = failed.get(id);
  if (at === undefined) return false;
  if (Date.now() - at < RETRY_MS) return true;
  failed.delete(id);
  return false;
};
let queue: { id: string; kind: string }[] = [];
let pumping = false;

/** TMDB is asked about IMDb ids of movies and series; anything else is unrated. */
const rateable = (title: Rated) => /^tt\d{1,10}$/.test(title.id) && (title.type === 'movie' || title.type === 'series');

/** Ratings the person's own Jellyfin or Plex server gave titles TMDB can't rate (see `noteServerRating`). */
const serverRatings = new Map<string, string>();
/** A title only on the person's own server: `jellyfin:…` or `plex:…` (one with an IMDb id goes by that). */
const serverOnly = (id: string) => /^(?:jellyfin|plex):/.test(id);

/**
 * Notes the age rating the person's own Jellyfin or Plex server gives a title
 * only it has (no IMDb id, so TMDB can't rate it). Without it such a title
 * counts as unrated, which Teens and "All but adult" show by default.
 * Called as the server's items become titles (library/media-server.ts).
 */
export function noteServerRating(id: string, certification: string | null | undefined): void {
  if (!serverOnly(id)) return;
  if (certification) serverRatings.set(id, certification);
  else serverRatings.delete(id);
}

/** A title's band; null when unrated or unknowable, undefined until looked up. */
function bandOf(title: Rated): Band | null | undefined {
  if (serverOnly(title.id)) return serverCertificationBand(serverRatings.get(title.id), region);
  if (!tmdb || !rateable(title)) return null;
  return bands.has(title.id) ? (bands.get(title.id) ?? null) : undefined;
}

const RatingsSchema = v.nullable(
  v.array(
    v.object({
      id: v.string(),
      certs: v.record(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/)), v.pipe(v.string(), v.maxLength(12))),
      adult: v.boolean(),
    }),
  ),
);

/**
 * Queues `title`'s lookup (once). An `urgent` one (a title page opening,
 * Play) goes to the front, ahead of every card a page has queued, so it
 * isn't left waiting behind Home's rows.
 */
function request(title: Rated, urgent = false): Promise<void> {
  const known = pending.get(title.id);
  if (known) {
    const at = urgent ? queue.findIndex((q) => q.id === title.id) : -1;
    if (at > 0) queue.unshift(...queue.splice(at, 1));
    return known.promise;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  pending.set(title.id, { promise, resolve });
  const entry = { id: title.id, kind: title.type };
  if (urgent) queue.unshift(entry);
  else queue.push(entry);
  if (!pumping) void pump();
  return promise;
}

/** Sends the queued lookups, one batch at a time, so a long page is many small requests rather than a flood. */
async function pump(): Promise<void> {
  pumping = true;
  // A page creates its cards in one go: wait a tick so they share batches.
  await new Promise((r) => setTimeout(r, 0));
  while (queue.length) {
    const batch = queue.slice(0, BATCH);
    queue = queue.slice(BATCH);
    let found: v.InferOutput<typeof RatingsSchema> = null;
    let lookedUp = true;
    try {
      found = v.parse(RatingsSchema, await invoke<unknown>('tmdb_certifications', { titles: batch, region }));
    } catch (err) {
      // Not "unrated": a profile that allows unrated titles would otherwise let anything through while offline. These stay blocked until a retry.
      console.warn('Could not look up ratings', err);
      lookedUp = false;
    }
    const byId = new Map((found ?? []).map((r) => [r.id, r]));
    for (const { id } of batch) {
      // Rust leaves out a title whose own lookup failed (one timing out, a 429) and answers one TMDB doesn't
      // know with no certifications: only that one is unrated; a missing one is a failure like the whole call's.
      if (!lookedUp || (found && !byId.has(id))) {
        failed.set(id, Date.now());
        pending.get(id)?.resolve();
        pending.delete(id);
        retryLater(id);
        continue;
      }
      failed.delete(id);
      const rating = byId.get(id);
      bands.set(id, rating ? titleBand(rating.certs, region, rating.adult) : null);
      const cert = rating && shownCertification(rating.certs, region);
      if (cert) certifications.set(id, cert);
      if (rating?.adult) adult.add(id);
      pending.get(id)?.resolve();
      pending.delete(id);
      watched(id);
    }
  }
  pumping = false;
}

export type Verdict = 'allowed' | 'blocked' | 'pending';

/** What `rule` says about `title` now; 'pending' while its rating is being looked up (which this starts). */
function verdictUnder(rule: ContentLimit, title: Rated): Verdict {
  if (!loaded) return 'pending';
  if (rule.level === 'off') return 'allowed';
  const band = bandOf(title);
  if (band === undefined) {
    if (lookupFailed(title.id)) return 'blocked';
    void request(title);
    return 'pending';
  }
  return allows(effective(rule), band) ? 'allowed' : 'blocked';
}

/**
 * `rule` as it applies now: without TMDB nearly every title is unrated, so a
 * limit that showed unrated titles (Teens and "All but adult" by default)
 * would filter nothing. Until a token is saved, unrated titles are hidden on
 * every limited profile, whatever its switch says (failing closed).
 */
const effective = (rule: ContentLimit): ContentLimit => (tmdb || !rule.allowUnrated ? rule : { ...rule, allowUnrated: false });

/** What the limit says about `title` now; 'pending' while its rating is being looked up (which this starts). */
export const verdictNow = (title: Rated): Verdict => verdictUnder(limit, title);

/** What the player is asked to open, as the limit sees it (see rooms/player's PlayRequest). */
export interface Played {
  title: Rated;
  live?: boolean | undefined;
  replay?: boolean | undefined;
  trailer?: boolean | undefined;
}

/** The title whose rating decides `request`: a trailer's id is `trailer:{title id}`. */
export const playedTitle = <T extends Rated>(request: { title: T; trailer?: boolean | undefined }): T =>
  request.trailer ? { ...request.title, id: request.title.id.replace(/^trailer:/, '') } : request.title;

/**
 * What the limit says about the player opening `request` now. Live TV and its
 * catch-up follow the profile's Live TV switch; anything else its title's
 * rating, which for a pasted link or a dropped file (no catalog id) is
 * unrated. The player asks this for every file it opens, so no page that
 * starts playback (Downloads, Search's "Play this link", Live TV, the queue…)
 * can leave the limit out.
 */
export function playVerdict(request: Played): Verdict {
  if (!loaded) return 'pending';
  if (request.live || request.replay) return liveTvAllowed() ? 'allowed' : 'blocked';
  return verdictNow(playedTitle(request));
}

/** Waits (up to `waitMs`) for every title's rating; `rule` defaults to the active profile's limit. */
async function settle(titles: readonly Rated[], waitMs: number, rule?: ContentLimit, urgent = false): Promise<void> {
  await loadContentLimit();
  const lookups = titles.filter((t) => verdictUnder(rule ?? limit, t) === 'pending').map((t) => request(t, urgent));
  if (lookups.length) await settleWithin(Promise.all(lookups), waitMs, undefined);
}

/**
 * Pending after the wait counts as blocked, not unrated: on a profile that
 * allows unrated titles, a slow TMDB would otherwise let an R-rated title
 * through. Cards and title pages look again once the rating lands.
 */
const decided = (title: Rated, rule: ContentLimit = limit): Exclude<Verdict, 'pending'> => {
  const verdict = verdictUnder(rule, title);
  return verdict === 'pending' ? 'blocked' : verdict;
};

/** Whether the profile may open or play `title`, waiting up to `waitMs` for its rating (blocked if it hasn't come). */
export async function verdictFor(title: Rated, waitMs = 8000): Promise<Exclude<Verdict, 'pending'>> {
  await settle([title], waitMs, undefined, true);
  return decided(title);
}

/** Whether the profile may open or play `title`, once its rating is in, however long that takes. */
export async function verdictOnceRated(title: Rated): Promise<Exclude<Verdict, 'pending'>> {
  await loadContentLimit();
  // A lookup always ends known or failed (blocked), so this asks at most once or twice.
  while (verdictNow(title) === 'pending') await request(title, true);
  return decided(title);
}

/**
 * The titles the profile may see, after waiting (briefly) for their ratings.
 * `also` is another profile's limit they must pass too: the avatar picker
 * choosing for a profile other than the active one.
 */
export async function allowedTitles<T extends Rated>(titles: readonly T[], waitMs = ROW_WAIT_MS, also: ContentLimit = NO_LIMIT): Promise<T[]> {
  await loadContentLimit();
  const rules = [limit, also].filter((rule) => rule.level !== 'off');
  if (!rules.length) return [...titles];
  // The active profile may have no limit, in which case the lookups weren't read yet.
  await loadLookups();
  // Any limit waits on the same lookups.
  await settle(titles, waitMs, rules[0]);
  return titles.filter((title) => rules.every((rule) => decided(title, rule) === 'allowed'));
}

/**
 * The entries of a list drawn at once (Downloads, History, the alerts panel)
 * that the profile may watch now. One whose rating is still being looked up
 * is left out until it's known (failing closed), and `redraw` runs once those
 * lookups end, so it appears then. Nothing is removed from the list itself.
 */
export function shownNow<T>(entries: readonly T[], titleOf: (entry: T) => Rated, redraw: () => void): T[] {
  if (loaded && limit.level === 'off') return [...entries];
  const pendingTitles: Rated[] = [];
  let failedAt = Infinity;
  const shown = entries.filter((entry) => {
    const title = titleOf(entry);
    const verdict = verdictNow(title);
    if (verdict === 'pending') pendingTitles.push(title);
    else if (verdict === 'blocked') failedAt = Math.min(failedAt, failed.get(title.id) ?? Infinity);
    return verdict === 'allowed';
  });
  // One wait per list: drawn again while it waits (Downloads' progress, say), it doesn't queue another.
  // The lookups the draw started are waited for after that wait, by the draw it ends in.
  if (pendingTitles.length && !listWaits.has(redraw)) {
    listWaits.add(redraw);
    const done = () => {
      listWaits.delete(redraw);
      redraw();
    };
    void settle(pendingTitles, LIST_WAIT_MS).then(done, done);
  }
  // An entry a failed lookup hid: the list is drawn again once that lookup may be retried.
  if (failedAt !== Infinity) redrawListAt(redraw, failedAt + RETRY_MS);
  return shown;
}

/** Lists (`shownNow`'s redraws) waiting for their entries' ratings. */
const listWaits = new Set<() => void>();
/** Lists with an entry a failed lookup hid, and when they're drawn again to retry it. */
const listRetries = new Map<() => void, number>();
let listRetryTimer: ReturnType<typeof setTimeout> | undefined;

function redrawListAt(redraw: () => void, at: number): void {
  listRetries.set(redraw, Math.min(listRetries.get(redraw) ?? Infinity, at));
  scheduleListRetries();
}

function scheduleListRetries(): void {
  clearTimeout(listRetryTimer);
  listRetryTimer = undefined;
  if (!listRetries.size) return;
  const next = Math.min(...listRetries.values());
  listRetryTimer = setTimeout(redrawDueLists, Math.max(0, next - Date.now()));
}

function redrawDueLists(): void {
  const now = Date.now();
  const due = [...listRetries].filter(([, at]) => at <= now).map(([redraw]) => redraw);
  for (const redraw of due) listRetries.delete(redraw);
  scheduleListRetries();
  // Drawing looks the entries up again (pending), and `shownNow` waits for them from there.
  for (const redraw of due) redraw();
}

/** Whether `title` is blocked only because its rating couldn't be looked up just now (offline, TMDB down), not for its rating. */
export const ratingUnreachable = (title: Rated): boolean => !bands.has(title.id) && lookupFailed(title.id);

/** Why `title` is blocked: the certification it was blocked for, or null for unrated. */
export const certificationOf = (title: Rated): string | null =>
  certifications.get(title.id) ?? (serverOnly(title.id) && bandOf(title) !== null ? (serverRatings.get(title.id) ?? null) : null);
export const isAdult = (title: Rated): boolean => adult.has(title.id);

/**
 * The certification to show on `title`'s age-rating badge, looking it up if
 * need be: the same batched lookup the limit uses (cached by Rust for weeks,
 * here for the session), so a page full of badges is a few small requests.
 * Null when unrated, unknown to TMDB, or without a TMDB token.
 */
export async function certificationFor(title: Rated): Promise<string | null> {
  await loadLookups();
  if (!tmdb || !rateable(title)) return null;
  if (!bands.has(title.id)) await request(title);
  return certificationOf(title);
}

/** Addons that mark themselves adult (`behaviorHints.adult`) are left out on a profile with any limit. */
export async function withoutAdultAddons<T extends { manifest: { behaviorHints: { adult: boolean } } }>(addons: T[]): Promise<T[]> {
  await loadContentLimit();
  return limit.level === 'off' ? addons : addons.filter((addon) => !addon.manifest.behaviorHints.adult);
}

// Cards: hidden until their title is known to be allowed.
const cardTitles = new WeakMap<HTMLElement, Rated>();
/** Cards waiting on a lookup, by title id. Emptied as each lookup ends (lookups always end). */
const waiting = new Map<string, Set<HTMLElement>>();
/** Cards made before the limit was read. */
let early: HTMLElement[] = [];

function applyCard(card: HTMLElement): void {
  const title = cardTitles.get(card);
  if (!title) return;
  const verdict = verdictNow(title);
  if (verdict === 'allowed') {
    // Only a card this module hid is shown again.
    if (card.dataset.parental) {
      card.hidden = false;
      delete card.dataset.parental;
    }
    return;
  }
  card.hidden = true;
  card.dataset.parental = verdict;
  if (verdict !== 'pending') return;
  if (!loaded) early.push(card);
  else waiting.set(title.id, (waiting.get(title.id) ?? new Set()).add(card));
}

function watched(id: string): void {
  const cards = waiting.get(id);
  waiting.delete(id);
  cards?.forEach(applyCard);
}

/**
 * Cards hidden because their lookup failed, by title id: looked at again once
 * the retry wait is over. Held weakly: a card on a kept page (off the document
 * while another page shows) waits here until that page is back, and one whose
 * page was dropped for good just goes.
 */
const retrying = new Map<string, Set<WeakRef<HTMLElement>>>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** A lookup failed: its cards stay hidden (blocked), and are checked again after the wait, so they don't stay hidden for good. */
function retryLater(id: string): void {
  const cards = waiting.get(id);
  waiting.delete(id);
  cards?.forEach(applyCard);
  if (cards?.size) retrying.set(id, new Set([...(retrying.get(id) ?? []), ...[...cards].map((card) => new WeakRef(card))]));
  retryTimer ??= setTimeout(retryNow, RETRY_MS);
}

function retryNow(): void {
  retryTimer = undefined;
  for (const [id, refs] of [...retrying]) {
    const cards = [...refs].flatMap((ref) => ref.deref() ?? []);
    // Only cards on screen ask again; a kept page's wait for it to come back (hidden meanwhile,
    // failing closed) rather than looking up titles nobody sees. None left: its page is gone.
    if (cards.length && !cards.some(isShown)) continue;
    retrying.delete(id);
    failed.delete(id);
    // Applying asks for the rating again (pending), and shows the cards once it's allowed;
    // a lookup that fails again puts them back here.
    cards.forEach(applyCard);
  }
  // Cards still waiting for their page: looked at again after another wait.
  if (retrying.size) retryTimer ??= setTimeout(retryNow, RETRY_MS);
}

// The connection is back: cards a failed lookup hid are looked at now, not after the rest of the wait.
// (`globalThis` is the window on the page; tests run without one.)
globalThis.addEventListener?.('online', () => {
  // Lists a failed lookup emptied are drawn again now too, their lookups no longer held back.
  if (listRetries.size) {
    for (const redraw of listRetries.keys()) listRetries.set(redraw, 0);
    failed.clear();
    redrawDueLists();
  }
  if (retryTimer === undefined) return;
  clearTimeout(retryTimer);
  retryNow();
});

/**
 * Keeps a card for `title` hidden unless the profile's limit allows the
 * title (see the cards in components/cards.ts). A no-op without a limit.
 */
export function guardCard<T extends HTMLElement>(card: T, title: Rated): T {
  if (loaded && limit.level === 'off') return card;
  cardTitles.set(card, title);
  applyCard(card);
  return card;
}

/**
 * Waits (briefly) for the ratings of guarded cards before a row is drawn,
 * and leaves out blocked ones, so rows appear once with what they'll keep
 * rather than shrinking as ratings arrive. A row whose cards are all still
 * hidden comes back empty (and hides).
 */
export async function settleCards(cards: HTMLElement[], waitMs = ROW_WAIT_MS): Promise<HTMLElement[]> {
  if (loaded && limit.level === 'off') return cards;
  const titles = cards.flatMap((card) => cardTitles.get(card) ?? []);
  await settle(titles, waitMs);
  const kept = cards.filter((card) => {
    const title = cardTitles.get(card);
    return !title || verdictNow(title) !== 'blocked';
  });
  return kept.some((card) => !card.hidden) ? kept : [];
}
