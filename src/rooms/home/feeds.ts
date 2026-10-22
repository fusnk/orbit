/**
 * Home's rows of titles as data, in Home's order and without its hidden
 * rows, for the phone remote's picker (app/remote-picker.ts). Home sets
 * them each time it draws; rows that aren't titles (mood chips, genres,
 * tiles) have none.
 */
import type { Title } from '../../catalog/titles';

/** A row's heading and how its titles load (the same loader its rail uses). */
export interface RowFeed {
  title: string;
  load(): Promise<readonly Title[]>;
}

/** Dispatched on `document` when Home has drawn, so its rows are known. */
export const HOME_FEEDS_KNOWN = 'orbit:home-feeds-known';

let current: (() => Promise<RowFeed[]>) | null = null;

/** Home's rows, once it has drawn (null before). */
export const homeFeeds = (): (() => Promise<RowFeed[]>) | null => current;

export function setHomeFeeds(feeds: () => Promise<RowFeed[]>): void {
  current = feeds;
  document.dispatchEvent(new Event(HOME_FEEDS_KNOWN));
}
