/**
 * Search's own cards: the big "Trending now" spotlights, the top result and
 * people. Text sits on artwork behind a dark shade, so it stays white on
 * every theme; everything else uses theme tokens (search.css).
 */
import { loadMeta } from '../../catalog/service';
import { tmdbRating, type PersonHit } from '../../catalog/tmdb';
import { fallbackHue, isShowType, type Title } from '../../catalog/titles';
import { artImage, backdropImage, titleMeta, withHue } from '../../components/cards';
import { icon } from '../../components/icons';
import { formatDecimal, locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { appearance } from '../../theme/appearance';

/** "★ 7.8" from TMDB, when a TMDB list has shown the title and it has no IMDb rating to show instead. */
function tmdbScore(title: Title): HTMLElement | '' {
  const score = tmdbRating(title.id);
  if (title.rating?.trim() || score === undefined) return '';
  return h('span', { class: 'search-score', title: t('search.score', { score: formatDecimal(score) }) }, icon('star', { filled: true }), formatDecimal(score));
}

/**
 * The title's name, replaced by its logo once the logo has loaded (when
 * Settings shows logos). TMDB's lists carry no logos, so the title's
 * details are asked for one. The name stays for screen readers.
 */
function nameOrLogo(title: Title, className: string): HTMLElement {
  const name = h('span', { class: `${className} search-name` }, h('span', { class: 'search-name-text' }, title.name));
  if (!appearance().logos) return name;
  const show = (url: string | undefined) => {
    if (!url?.startsWith('https://')) return;
    const logo = h('img', { class: 'search-logo', src: url, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
    logo.addEventListener('load', () => name.classList.add('has-logo'), { once: true });
    logo.addEventListener('error', () => logo.remove(), { once: true });
    name.append(logo);
  };
  if (title.logo) show(title.logo);
  else if (/^tt\d+$/.test(title.id)) void loadMeta(title.type, title.id).then((full) => show(full?.logo), () => undefined);
  return name;
}

const kindLabel = (title: Title) => t(isShowType(title.type) ? 'search.kind.series' : 'search.kind.movie');

/** A large trending card: artwork, rank, logo or name, kind · year · rating. */
export function spotlightCard(title: Title, rank: number, onOpen: () => void): HTMLElement {
  const card = withHue(
    h(
      'button',
      { class: 'search-spot', 'data-focus-id': `spot:${title.id}`, 'aria-label': t('search.spotlight.label', { rank, name: title.name }) },
      h('span', { class: 'search-spot-art', 'aria-hidden': 'true' }, backdropImage(title, 'art')),
      h('span', { class: 'search-spot-shade', 'aria-hidden': 'true' }),
      h('span', { class: 'search-spot-rank', 'aria-hidden': 'true' }, String(rank)),
      h(
        'span',
        { class: 'search-spot-text', 'aria-hidden': 'true' },
        nameOrLogo(title, 'search-spot-name'),
        h('span', { class: 'search-spot-meta' }, h('span', {}, kindLabel(title)), title.year ? h('span', {}, title.year) : '', tmdbScore(title)),
      ),
    ),
    fallbackHue(title.name),
  );
  card.addEventListener('click', onOpen);
  return card;
}

export function spotlightSkeleton(): HTMLElement {
  return h('div', { class: 'skeleton search-spot-skeleton', 'aria-hidden': 'true' });
}

export interface TopResultActions {
  eyebrow: string;
  play(): void;
  open(): void;
  playLabel: string;
}

/** The best match, large: artwork, logo or name, details, overview, Play and Details. */
export function topResultCard(title: Title, actions: TopResultActions): HTMLElement {
  const play = h('button', { class: 'button large primary' }, icon('play', { filled: true }), actions.playLabel);
  play.addEventListener('click', actions.play);
  const details = h('button', { class: 'button large glass' }, icon('info'), t('browse.hero.details'));
  details.addEventListener('click', actions.open);
  const facts = titleMeta(title, { genres: true });
  const meta = [h('span', {}, kindLabel(title)), facts.length ? h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·') : '', ...facts];
  const card = h(
    'section',
    { class: 'search-top', 'aria-label': actions.eyebrow },
    h('div', { class: 'search-top-art', 'aria-hidden': 'true' }, backdropImage(title, 'art', true)),
    h('div', { class: 'search-top-shade', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'search-top-text' },
      h('span', { class: 'search-top-eyebrow' }, icon('star', { filled: true }), actions.eyebrow),
      h('h2', { class: 'search-top-title' }, nameOrLogo(title, 'search-top-name')),
      h('div', { class: 'search-top-meta' }, ...meta, tmdbScore(title)),
      title.description ? h('p', { class: 'search-top-desc' }, title.description) : '',
      h('div', { class: 'hero-actions' }, play, details),
    ),
  );
  // The whole card opens the title for the mouse; keyboard users have the buttons.
  card.addEventListener('click', (event) => {
    if (!(event.target instanceof Element && event.target.closest('button'))) actions.open();
  });
  return card;
}

/** A person: round photo (or initials), name, and a few titles they're known for. */
export function personCard(person: PersonHit, onOpen: () => void): HTMLElement {
  const words = person.name.split(/\s+/);
  const initials = [words[0], words.length > 1 ? words.at(-1) : undefined].map((word) => word?.[0]?.toLocaleUpperCase(locale()) ?? '').join('');
  const photo = withHue(h('span', { class: 'search-person-photo', 'aria-hidden': 'true' }, h('span', { class: 'search-person-initials' }, initials)), fallbackHue(person.name));
  if (person.photo) photo.append(artImage(person.photo, 'art'));
  const known = person.knownFor.join(', ');
  const card = h(
    'button',
    { class: 'search-person', 'data-focus-id': `person:${person.id}`, title: known ? `${person.name} · ${known}` : person.name },
    photo,
    h('span', { class: 'search-person-name' }, person.name),
    known ? h('span', { class: 'search-person-known' }, known) : '',
  );
  card.addEventListener('click', onOpen);
  return card;
}
