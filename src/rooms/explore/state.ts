/**
 * What every part of Discover shares: the titles the person isn't interested
 * in (left out of every row, grid, banner and queue), and the title menu
 * with "Not interested" added.
 */
import { taste, updateTaste, withHidden } from '../../catalog/taste';
import type { Title } from '../../catalog/titles';
import { toast } from '../../components/toast';
import { t } from '../../i18n';

/** Dispatched on `document` with the title's id when it's marked Not interested. */
export const EXPLORE_HIDDEN = 'orbit:explore-hidden';

let hidden = new Set<string>();

/** Reads the profile's Not interested titles; Discover's views wait for it before drawing titles. */
export async function loadHidden(): Promise<void> {
  hidden = new Set((await taste()).hidden);
}

export const notHidden = (title: Pick<Title, 'id'>) => !hidden.has(title.id);
export const visible = <T extends Pick<Title, 'id'>>(titles: readonly T[]): T[] => titles.filter(notHidden);

/** Marks a title Not interested; its cards leave every Discover view at once. */
export function hideTitle(title: Pick<Title, 'id' | 'name'>): void {
  hidden.add(title.id);
  document.dispatchEvent(new CustomEvent(EXPLORE_HIDDEN, { detail: title.id }));
  toast(t('explore.hidden', { name: title.name }));
  void updateTaste((current) => withHidden(current, title.id)).catch((err: unknown) => console.warn('Could not save Not interested', err));
}

let clears = 0;

/** Clears Not interested (Customize). */
export function clearHidden(): void {
  hidden = new Set();
  clears++;
}

/** How many times Not interested was cleared: Discover builds its sections again when it changes. */
export const hiddenClears = () => clears;

/**
 * Removes a hidden title's cards from `root` whenever one is hidden; returns
 * a function that stops listening (for views that are dropped).
 */
export function removeHiddenCards(root: HTMLElement): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<string>).detail;
    for (const card of root.querySelectorAll(`[data-focus-id="poster:${CSS.escape(id)}"]`)) {
      // Marked from its own menu, which handed focus back to it: the next card along takes it, not nothing.
      if (card.contains(document.activeElement)) {
        const beside = [card.nextElementSibling, card.previousElementSibling].find((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-focus-id]'));
        beside?.focus({ preventScroll: true });
      }
      card.remove();
    }
  };
  document.addEventListener(EXPLORE_HIDDEN, listener);
  return () => document.removeEventListener(EXPLORE_HIDDEN, listener);
}

/** The shared title menu (right-click, Menu key) with "Not interested" added. */
export function exploreMenu(withMenu: (card: HTMLElement, title: Title, extra?: { label: string; action(): void }[]) => HTMLElement) {
  return (card: HTMLElement, title: Title) => withMenu(card, title, [{ label: t('explore.hide'), action: () => hideTitle(title) }]);
}
