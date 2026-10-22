/**
 * Tags on Home's cards, and on landscape cards elsewhere (rooms/title-card.ts):
 * "New episode" or "New season" in the artwork's corner, and under a
 * landscape card the latest episode ("S14.E19 · Oct 2").
 * Only from what's already loaded — the new-episode alerts' series (see
 * library/alerts.ts) — so no card fetches anything of its own. Cards keep
 * their title's id, so the tags follow the alerts and the Home builder's
 * switch without redrawing the rows.
 */
import { locale, t } from '../../i18n';
import { isShowType, type Title } from '../../catalog/titles';
import { h } from '../../lib/dom';
import { airedDateText, alertItems } from '../../library/alerts';
import { cardTag, episodeCode, latestEpisode, type CardTag } from './extras';

const TAG_LABELS: Record<CardTag, () => string> = {
  'new-episode': () => t('homerows.tags.new-episode'),
  'new-season': () => t('homerows.tags.new-season'),
};

let enabled = true;

/** Turns the tags on or off, and updates the cards already under `root`. */
export function setCardTags(on: boolean, root: ParentNode): void {
  if (on === enabled) return;
  enabled = on;
  refreshCardTags(root);
}

/** Marks a series' card to carry tags, and tags it now. Other titles are left as they are. */
export function tagCard<T extends HTMLElement>(card: T, title: Title): T {
  if (!isShowType(title.type)) return card;
  card.dataset.tagsFor = title.id;
  apply(card, title.id, alertItems(), Date.now());
  return card;
}

/** Brings every tagged card under `root` up to date (after the alerts or the switch change). */
export function refreshCardTags(root: ParentNode): void {
  const items = alertItems();
  const now = Date.now();
  for (const card of root.querySelectorAll<HTMLElement>('[data-tags-for]')) apply(card, card.dataset.tagsFor!, items, now);
}

/** "S14.E19 · Oct 2": dated as the bell dates it (the alerts keep air dates as the start of their day locally). */
export const latestEpisodeText = (latest: NonNullable<ReturnType<typeof latestEpisode>>): string => `${episodeCode(latest)} · ${airedDateText(latest.airedAt, locale(), latest.exact)}`;

function apply(card: HTMLElement, titleId: string, items: ReturnType<typeof alertItems>, now: number): void {
  card.querySelectorAll('.card-tag, .card-episode').forEach((el) => el.remove());
  if (!enabled) return;
  const tag = cardTag(titleId, items, now);
  if (tag) card.querySelector('.frame')?.append(h('span', { class: 'card-tag' }, TAG_LABELS[tag]()));
  if (!card.classList.contains('landscape-card')) return;
  const latest = latestEpisode(titleId, items, now);
  if (latest) card.querySelector('.card-text')?.append(h('span', { class: 'card-episode' }, latestEpisodeText(latest)));
}
