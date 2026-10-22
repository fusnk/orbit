/**
 * Where a profile's content limit stops something on screen: a title page
 * that isn't allowed, playing it, Live TV, and queued titles. The decisions
 * themselves are in catalog/parental.ts.
 */
import type { RoomContext } from '../../app/router';
import { allowedTitles, certificationOf, contentLimit, isAdult, liveTvAllowed, loadContentLimit, limited, playedTitle, playVerdict, ratingUnreachable, verdictFor, verdictNow, verdictOnceRated, type Played } from '../../catalog/parental';
import type { Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { dequeue, loadQueue, queueItems } from '../../library/queue';
import { LEVEL_LABELS } from './content-limit';
import './parental.css';

/**
 * Reads the active profile's limit (before the first page draws) and, with a
 * limit, drops queued titles it doesn't allow, so the queue never plays one.
 */
export async function startContentLimit(): Promise<void> {
  await loadContentLimit();
  if (limited()) void dropBlockedFromQueue().catch((err: unknown) => console.warn('Could not check the queue against the content limit', err));
}

async function dropBlockedFromQueue(): Promise<void> {
  await loadQueue();
  const items = [...queueItems()];
  if (!items.length) return;
  await allowedTitles(
    items.map((item) => item.title),
    15_000,
  );
  for (const item of items) if (verdictNow(item.title) === 'blocked') await dequeue(item.id);
}

/** A full-page "Not available on this profile", with a way back. */
export function notAvailable(message: string, ctx: RoomContext): HTMLElement {
  const back = h('button', { class: 'button large glass', 'data-autofocus': true }, t('titles.common.back'));
  back.addEventListener('click', () => ctx.back());
  return h('div', { class: 'parental-block' }, h('span', { class: 'parental-block-icon', 'aria-hidden': 'true' }, icon('lock')), h('h1', { class: 'parental-block-title' }, t('parental.blocked.title')), h('p', { class: 'muted' }, message), back);
}

function blockedMessage(title: Pick<Title, 'id' | 'type' | 'name'>): string {
  // Not "couldn't find a rating": it has one, Orbit just couldn't reach TMDB to read it.
  if (ratingUnreachable(title)) return t('parental.blocked.unreachable', { name: title.name });
  if (isAdult(title)) return t('parental.blocked.adult', { name: title.name });
  const rating = certificationOf(title);
  return rating ? t('parental.blocked.rated', { name: title.name, rating, level: t(LEVEL_LABELS[contentLimit().level]) }) : t('parental.blocked.unrated', { name: title.name });
}

/**
 * A title page, unless the profile's limit stops it. `build` draws the page
 * into the element it's given (the router keeps that element as the view, so
 * it's drawn into rather than swapped). While the rating is looked up the
 * page stays empty, so nothing of a blocked title shows.
 */
export function gateTitlePage(title: Title, ctx: RoomContext, build: (root?: HTMLElement) => HTMLElement): HTMLElement {
  const now = verdictNow(title);
  if (now === 'allowed') return build();
  const root = h('article', { class: 'detail parental-gate', 'aria-busy': 'true' });
  const decide = (verdict: 'allowed' | 'blocked') => {
    root.removeAttribute('aria-busy');
    if (verdict === 'allowed') {
      root.classList.remove('parental-gate');
      // The "still checking" page may be up.
      root.replaceChildren();
      build(root);
      // Opening the page found nothing to focus while it waited: Play takes it, unless the person has moved on.
      if (root.isConnected && (!document.activeElement || document.activeElement === document.body)) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
      return;
    }
    root.replaceChildren(notAvailable(blockedMessage(title), ctx));
    if (root.isConnected) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  };
  if (now === 'blocked') decide('blocked');
  else
    void verdictFor(title).then((verdict) => {
      if (verdict === 'allowed' || verdictNow(title) !== 'pending') return decide(verdict);
      // Still no rating after the wait: blocked for now (not "unrated"), and the page opens itself once it lands.
      root.removeAttribute('aria-busy');
      root.replaceChildren(notAvailable(t('parental.blocked.checking', { name: title.name }), ctx));
      if (root.isConnected) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
      void verdictOnceRated(title).then(decide);
    });
  return root;
}

/**
 * Whether `title` may be played now. If its rating isn't known yet, false,
 * and `retry` runs once it's known to be allowed; a blocked title says so.
 * A rating still on its way after the wait counts as blocked: the person is
 * told to try again rather than playback starting by itself much later.
 */
export function playAllowed(title: Pick<Title, 'id' | 'type' | 'name'>, retry: () => void): boolean {
  if (verdictNow(title) === 'allowed') return true;
  void verdictFor(title).then((verdict) => {
    if (verdict === 'allowed') return retry();
    toast(t(verdictNow(title) === 'pending' ? 'parental.blocked.checking-toast' : ratingUnreachable(title) ? 'parental.blocked.unreachable' : 'parental.blocked.toast', { name: title.name }));
  });
  return false;
}

/**
 * Whether the player may open `request` now (see `playVerdict`): the one check
 * every file the player opens goes through, wherever it was started. As
 * `playAllowed`, a rating still unknown runs `retry` once it's allowed.
 */
export function mayPlay(request: Played & { title: Pick<Title, 'id' | 'type' | 'name'> }, retry: () => void): boolean {
  const verdict = playVerdict(request);
  if (verdict === 'allowed') return true;
  if (!request.live && !request.replay) return playAllowed(playedTitle(request), retry);
  if (verdict === 'blocked') toast(t('parental.blocked.live'));
  // The limit isn't read yet (only before the first page draws).
  else void loadContentLimit().then(() => (playVerdict(request) === 'allowed' ? retry() : toast(t('parental.blocked.live'))));
  return false;
}

/** The Live TV page, unless the profile's limit turns Live TV off. */
export function gateLiveTv(ctx: RoomContext, build: () => HTMLElement): HTMLElement {
  return liveTvAllowed() ? build() : h('section', { class: 'parental-page' }, notAvailable(t('parental.blocked.live'), ctx));
}
