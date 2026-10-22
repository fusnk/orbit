import { expect, it } from 'vitest';
import { shownTabs } from './tabs';

const TABS = ['all', 'continue', 'queue', 'watched', 'favourites', 'history', 'lists', 'calendar', 'stats', 'cloud'].map((id) => ({ id }));
const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

it('keeps My Lists (and its Import a list) in reach with no list yet, beside All and Stats', () => {
  const counts = new Map([['all', 3], ['lists', 0]]);
  expect(ids(shownTabs(TABS, counts, 'all'))).toEqual(['all', 'lists', 'stats']);
});

it('shows nothing (the welcome page) while the library holds nothing at all', () => {
  expect(ids(shownTabs(TABS, new Map([['all', 0], ['lists', 0]]), 'all'))).toEqual([]);
});

it('keeps the queue, favourites and history only while open and emptied', () => {
  const counts = new Map([['all', 1]]);
  expect(ids(shownTabs(TABS, counts, 'queue'))).toEqual(['all', 'queue', 'lists', 'stats']);
  expect(ids(shownTabs(TABS, counts, 'calendar'))).toEqual(['all', 'lists', 'stats']);
});
