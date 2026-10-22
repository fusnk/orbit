/**
 * Home's Continue Watching rail, drawn once the profile's content limit has
 * had a moment to decide its cards (as the other rows are).
 */
import { settleCards, shownNow } from '../../catalog/parental';
import { rail } from '../../components/cards';
import { t } from '../../i18n';
import type { Title } from '../../catalog/titles';

/**
 * The rail, or null with nothing to show. When the limit has kept nothing
 * yet (ratings slow or unreachable; `cards` are the entries' cards, in
 * order), `redraw` runs once those lookups end or may be retried, as the
 * lists do (`shownNow`): the limit only shows a card again while it's on the
 * page, so a row drawn empty stayed empty until the next watch.
 */
export async function continueRail(entries: readonly Title[], cards: HTMLElement[], redraw: () => void): Promise<HTMLElement | null> {
  const kept = await settleCards(cards);
  if (kept.length) return rail({ title: t('browse.home.continue-watching'), cards: kept, variant: 'continue' });
  if (entries.length) shownNow(entries, (title) => title, redraw);
  return null;
}
