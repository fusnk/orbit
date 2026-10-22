/**
 * A film's popular Letterboxd reviews on its title page (no account needed;
 * see catalog/letterboxd.ts). Reviews are plain text from Rust, drawn with
 * text nodes only. Ones marked as containing spoilers stay hidden until asked for.
 */
import { openInBrowser } from '../../lib/browser';
import { stars, type LetterboxdReview, type LetterboxdReviews } from '../../catalog/letterboxd';
import { artImage, withHue } from '../../components/cards';
import { fallbackHue } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';

/** Reviews shown before "Show more". */
const SHOWN = 5;

const open = (url: string) => void openInBrowser(url).catch((err: unknown) => console.warn('Couldn’t open Letterboxd', err));

/** Fills `section` with the reviews; hides it when there are none. */
export function fillReviews(section: HTMLElement, found: LetterboxdReviews | null): void {
  const reviews = found?.reviews ?? [];
  section.hidden = !found || !reviews.length;
  if (!found || !reviews.length) return;

  const all = h('button', { class: 'see-all', 'data-nav-axis': 'horizontal' }, t('titles.detail.reviews-all'));
  all.addEventListener('click', () => open(found.url));
  const list = h('div', { class: 'review-list' }, ...reviews.slice(0, SHOWN).map(reviewCard));
  const more = h('button', { class: 'button review-more' }, tn('titles.detail.reviews-show-more', reviews.length - SHOWN));
  more.addEventListener('click', () => {
    const rest = reviews.slice(SHOWN).map(reviewCard);
    list.append(...rest);
    more.remove();
    // The button is gone; focus goes on to the first review it showed.
    rest[0]?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  });

  section.replaceChildren(
    h('div', { class: 'cast-header' }, h('h2', { class: 'section-title' }, tn('titles.detail.reviews', reviews.length)), all),
    list,
    reviews.length > SHOWN ? more : '',
  );
}

function reviewCard(review: LetterboxdReview): HTMLElement {
  const author = h('button', { class: 'review-author', title: t('titles.detail.reviews-open') }, review.author);
  author.addEventListener('click', () => open(review.url));
  const avatar = withHue(h('span', { class: 'review-avatar', 'aria-hidden': 'true' }, review.author.trim().charAt(0).toLocaleUpperCase(locale())), fallbackHue(review.author));
  if (review.avatar) avatar.append(artImage(review.avatar, 'art'));

  const text = h('p', { class: 'review-text', dir: 'auto' }, review.text);
  let body: HTMLElement = text;
  if (review.spoilers) {
    const reveal = h('button', { class: 'review-spoiler' }, icon('info'), t('titles.detail.reviews-spoilers'));
    reveal.addEventListener('click', () => {
      reveal.replaceWith(text);
      author.focus({ preventScroll: true });
    });
    body = reveal;
  }

  return h(
    'article',
    { class: 'review' },
    avatar,
    h(
      'div',
      { class: 'review-main' },
      h(
        'div',
        { class: 'review-head' },
        author,
        review.rating ? h('span', { class: 'review-stars', role: 'img', 'aria-label': t('titles.detail.reviews-stars', { rating: review.rating }) }, stars(review.rating)) : '',
        review.liked ? h('span', { class: 'review-liked', role: 'img', title: t('titles.detail.reviews-liked'), 'aria-label': t('titles.detail.reviews-liked') }, '♥') : '',
      ),
      body,
    ),
  );
}
