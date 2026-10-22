/**
 * Orbit's own rating posters: a title's IMDb, TMDB and Letterboxd scores
 * drawn on its card's artwork (Settings → Appearance → Ratings on posters).
 * Only scores Orbit already has are used: the addon's IMDb rating, TMDB's
 * from lists shown this session, and both from title pages opened this
 * session. Nothing is fetched per card.
 *
 * Every card carries all its scores; CSS shows none, the first or all of
 * them (data-poster-ratings on <html>, poster-scores.css), so changing the
 * setting redraws nothing. The marks are drawn in CSS too: a card adds a
 * few spans, no SVG or images. The overlay is hidden from screen readers;
 * the card's accessible description says the scores it shows instead, and
 * follows the setting (kept pages catch up when they're shown again).
 */
import './poster-scores.css';
import { knownExtraScores } from '../catalog/extras';
import { tmdbRating } from '../catalog/tmdb';
import type { Title } from '../catalog/titles';
import { formatList, t } from '../i18n';
import { VIEW_SHOWN } from '../app/router';
import { h } from '../lib/dom';
import { posterScores, shownScores, SITE_NAMES, type PosterScore } from '../lib/poster-ratings';
import { appearance, POSTER_RATINGS_CHANGED } from '../theme/appearance';

/** The scores Orbit has for `title` right now. */
export function scoresFor(title: Title): PosterScore[] {
  const seen = knownExtraScores(title.id);
  return posterScores({ imdb: title.rating, tmdb: tmdbRating(title.id) ?? seen?.tmdb, letterboxd: seen?.letterboxd });
}

/** The overlay for a card's frame, or nothing when there are no scores. */
export function scoresOverlay(scores: PosterScore[]): HTMLElement | '' {
  if (!scores.length) return '';
  return h(
    'span',
    { class: 'poster-scores', 'aria-hidden': 'true' },
    ...scores.map((s) => h('span', { class: `poster-score ${s.site}` }, h('span', { class: 'poster-score-mark' }), h('span', { class: 'poster-score-value' }, s.value))),
  );
}

const DESCRIBED = '[data-scores]';
const cardScores = new WeakMap<HTMLElement, PosterScore[]>();
/** Bumped when the setting changes; a kept page is brought up to date when it's shown. */
let version = 0;
const upToDate = new WeakMap<Element, number>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(POSTER_RATINGS_CHANGED, () => {
    version++;
    describeAll(document);
  });
  // VIEW_SHOWN doesn't bubble, but it still passes the document on its way down.
  document.addEventListener(
    VIEW_SHOWN,
    (event) => {
      const view = event.target;
      if (view instanceof Element && upToDate.get(view) !== version) {
        upToDate.set(view, version);
        describeAll(view);
      }
    },
    true,
  );
}

function describeAll(root: ParentNode): void {
  for (const card of root.querySelectorAll<HTMLElement>(DESCRIBED)) describe(card);
}

/** The scores the setting shows, said once: none with it off, the first with Minimal, all with Full. */
function describe(card: HTMLElement): void {
  const said = shownScores(cardScores.get(card) ?? [], appearance().posterRatings).map((s) => t(s.outOf === 5 ? 'posters.score-of-5' : 'posters.score', { site: SITE_NAMES[s.site], value: s.value }));
  if (said.length) card.setAttribute('aria-description', t('posters.description', { scores: formatList(said) }));
  else card.removeAttribute('aria-description');
}

/** "Ratings: IMDb 8.1, Letterboxd 3.9 out of 5", as the card's accessible description, for the scores the setting shows. */
export function describeScores(card: HTMLElement, scores: PosterScore[]): void {
  if (!scores.length) return;
  listen();
  cardScores.set(card, scores);
  card.dataset.scores = '';
  describe(card);
}
