/**
 * Featured & Recommended: Home's banner with ten picks, TMDB's trending
 * titles mixed with recommendations from what the person watched and liked.
 * Thumbs up makes a pick a taste seed (its recommendations join Featured and
 * the Discovery Queue next time); thumbs down means it's never featured again.
 */
import { tmdbList } from '../../catalog/tmdb';
import { interleave, taste, updateTaste, withDown, withoutUp, withUp } from '../../catalog/taste';
import type { Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { inLibrary, toggleLibrary } from '../../library/library';
import { lastWatchedAt } from '../../library/watch';
import { appearance } from '../../theme/appearance';
import { primaryLabel } from '../detail/title-actions';
import { createHero } from '../home/hero';
import { notHidden } from './state';

const FEATURED = 10;
const pad = (n: number) => String(n).padStart(2, '0');

export interface FeaturedDeps {
  play(title: Title): void;
  openDetail(title: Title): void;
  /** Recommendations from the person's seeds, merged (see index.ts). */
  recommendations(): Promise<Title[]>;
}

/** Fills `slot` with the banner; empty if there's nothing to feature. */
export async function renderFeatured(slot: HTMLElement, deps: FeaturedDeps): Promise<void> {
  const [trending, recs, { down }] = await Promise.all([tmdbList('trending-week').catch(() => null), deps.recommendations().catch(() => [] as Title[]), taste()]);
  const never = new Set(down);
  const fromRecs = new Set(recs.map((title) => title.id));
  // Only titles with landscape art and a description make a good banner.
  // Nothing already started (the banner is for something new), thumbed down or not wanted.
  let items = interleave([recs, trending ?? []], (title) => never.has(title.id) || !notHidden(title) || lastWatchedAt(title.id) > 0 || !title.background || !title.description, FEATURED);
  if (!items.length) return void slot.replaceChildren();

  const draw = (start: number) => {
    const like = h('button', { class: 'button large glass icon-only explore-like', 'aria-pressed': 'false', title: t('explore.featured.like'), 'aria-label': t('explore.featured.like') }, icon('thumbUp'));
    const dislike = h('button', { class: 'button large glass icon-only', title: t('explore.featured.dislike'), 'aria-label': t('explore.featured.dislike') }, icon('thumbDown'));
    let current: () => Title = () => items[0]!;
    const liked = new Set<string>();
    void taste().then((saved) => {
      for (const seed of saved.up) liked.add(seed.id);
      like.setAttribute('aria-pressed', String(liked.has(current().id)));
    });
    like.addEventListener('click', () => {
      const title = current();
      // A second press takes the thumbs up back, as its pressed state says it would.
      if (liked.has(title.id)) {
        like.setAttribute('aria-pressed', 'false');
        liked.delete(title.id);
        void updateTaste((saved) => withoutUp(saved, title.id)).catch((err: unknown) => console.warn('Could not take back the thumbs up', err));
        return;
      }
      like.setAttribute('aria-pressed', 'true');
      liked.add(title.id);
      toast(t('explore.featured.liked', { name: title.name }));
      void updateTaste((saved) => withUp(saved, title)).catch((err: unknown) => console.warn('Could not save the thumbs up', err));
    });
    dislike.addEventListener('click', () => {
      const title = current();
      const index = items.indexOf(title);
      toast(t('explore.featured.disliked', { name: title.name }));
      void updateTaste((saved) => withDown(saved, title.id)).catch((err: unknown) => console.warn('Could not save the thumbs down', err));
      items = items.filter((other) => other !== title);
      if (!items.length) return void slot.replaceChildren();
      draw(Math.min(index, items.length - 1));
      // The banner was rebuilt; keep the keyboard where it was.
      slot.querySelector<HTMLElement>('.hero-actions .button:last-child')?.focus({ preventScroll: true });
    });
    slot.replaceChildren(
      createHero(
        items,
        {
          primaryLabel,
          play: deps.play,
          details: deps.openDetail,
          inLibrary: (title) => inLibrary(title.id),
          rank: () => undefined,
          toggleLibrary: (title) => toggleLibrary(title),
          badges: () => [],
          logos: () => appearance().logos,
        },
        {
          eyebrow: (title, index, count) => {
            const counter = t('explore.featured.counter', { index: pad(index + 1), count: pad(count) });
            return fromRecs.has(title.id) ? t('explore.featured.for-you', { counter }) : t('explore.featured.trending', { counter });
          },
          actions: (shown) => {
            current = shown;
            return [like, dislike];
          },
          onShow: (title) => like.setAttribute('aria-pressed', String(liked.has(title.id))),
          start,
        },
      ),
    );
  };
  draw(0);
}
