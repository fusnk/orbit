/**
 * Discover's browse tiles: a genre (a collage of its films' backdrops,
 * tinted by the genre's colour), a language (its own name in its own script
 * faintly behind), an award (its name and category).
 */
import { artImage, withHue } from '../../components/cards';
import { h } from '../../lib/dom';

export interface Tile {
  element: HTMLButtonElement;
  /** Fills the collage once the artwork is known. */
  setArt(urls: readonly string[]): void;
}

export function browseTile(options: { name: string; hue: number; sub?: string | undefined; native?: string | undefined; variant?: 'language' | 'award'; onOpen(): void }): Tile {
  const art = h('span', { class: 'explore-tile-art', 'aria-hidden': 'true' });
  const element = withHue(
    h(
      'button',
      { class: `explore-tile ${options.variant ? `explore-tile-${options.variant}` : ''}`.trim() },
      art,
      h('span', { class: 'explore-tile-tint', 'aria-hidden': 'true' }),
      options.native ? h('span', { class: 'explore-tile-native', 'aria-hidden': 'true' }, options.native) : '',
      h('span', { class: 'explore-tile-text' }, h('span', { class: 'explore-tile-name' }, options.name), options.sub ? h('span', { class: 'explore-tile-sub' }, options.sub) : ''),
    ),
    options.hue,
  );
  element.addEventListener('click', options.onOpen);
  return {
    element,
    setArt: (urls) => {
      art.dataset.count = String(Math.min(urls.length, 3));
      art.replaceChildren(...urls.slice(0, 3).map((url) => artImage(url, 'explore-tile-image')));
    },
  };
}
