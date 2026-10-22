/**
 * The featured banner at the top of Movies / TV Shows / Anime and My Library:
 * the title's backdrop, its name (or logo), a meta line and Play / Details.
 * Its artwork also tints the page's ambient glow.
 */
import { fallbackHue, type Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { icon } from '../../components/icons';
import { titleHeading } from '../../components/title-logo';
import { t } from '../../i18n';
import { artHue } from '../../lib/art-hue';
import { h } from '../../lib/dom';
import { isShown } from '../../lib/shown';
import { DEFAULT_AMBIENT_HUE, setAmbientHue } from '../../theme/ambient';

export interface FeaturedOptions {
  /** The primary button's label ("Play", "Resume S2 E4", …). */
  playLabel: string;
  play(): void;
  openDetail(): void;
  /** The line under the name. */
  meta: (Node | string)[];
  /** Drawn under the meta line (e.g. how far in a resumable title is). */
  extra?: Node;
}

/** Draws `title` into `featured` (hidden when there's none); `page` carries the ambient hue. */
export function fillFeatured(featured: HTMLElement, page: HTMLElement, title: Title | undefined, options?: FeaturedOptions): void {
  featured.hidden = !title || !options;
  if (!title || !options) return void delete featured.dataset.titleId;
  const playButton = h('button', { class: 'button large primary', 'data-focus-id': 'featured:play', 'data-nav-default': true }, icon('play', { filled: true }), options.playLabel);
  playButton.addEventListener('click', () => options.play());
  const details = h('button', { class: 'button large glass', 'data-focus-id': 'featured:details' }, t('browse.hero.details'));
  details.addEventListener('click', () => options.openDetail());
  featured.replaceChildren(
    title.background ? artImage(title.background, 'featured-art', true) : '',
    h('div', { class: 'featured-shade', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'featured-content' },
      titleHeading('h2', 'featured-title', title),
      h('div', { class: 'hero-meta' }, ...options.meta),
      options.extra ?? '',
      h('div', { class: 'hero-actions' }, playButton, details),
    ),
  );
  // The ambient glow follows the featured artwork.
  page.dataset.hue = String(fallbackHue(title.id));
  featured.dataset.titleId = title.id;
  if (title.background) {
    void artHue(title.background).then((hue) => {
      // Another title has been featured meanwhile.
      if (featured.dataset.titleId !== title.id) return;
      page.dataset.hue = String(hue ?? DEFAULT_AMBIENT_HUE);
      if (isShown(page)) setAmbientHue(hue ?? DEFAULT_AMBIENT_HUE);
    });
  }
}
