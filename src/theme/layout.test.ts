import { describe, expect, it } from 'vitest';
import { arrangeItems, cleanLabel, moveItem, parseNavLayout } from './layout';

describe('nav layouts', () => {
  it('read a saved layout and fall back to the top bar', () => {
    expect(parseNavLayout({ position: 'rail', side: 'end', items: [{ id: 'anime', hidden: true }] })).toEqual({ position: 'rail', side: 'end', align: 'center', place: 'bottom', items: [{ id: 'anime', label: null, hidden: true }] });
    expect(parseNavLayout({ position: 'dock' })).toEqual({ position: 'dock', side: 'start', align: 'center', place: 'bottom', items: [] });
    for (const bad of [null, 'sidebar', { position: 'floating' }, { position: 'top', side: 'left' }, { position: 'top', items: [{ id: '<b>' }] }]) {
      expect(parseNavLayout(bad)).toEqual({ position: 'top', side: 'start', align: 'center', place: 'bottom', items: [] });
    }
  });

  it('read the top bar’s alignment, centred unless saved otherwise', () => {
    expect(parseNavLayout({ position: 'top', align: 'start' }).align).toBe('start');
    expect(parseNavLayout({ position: 'cinematic', side: 'end', align: 'start' })).toEqual({ position: 'cinematic', side: 'end', align: 'start', place: 'bottom', items: [] });
    // Saved before alignment existed, or by a newer Orbit: centred, and the rest is kept.
    expect(parseNavLayout({ position: 'rail', side: 'end' }).align).toBe('center');
    expect(parseNavLayout({ position: 'rail', side: 'end', align: 'middle', items: [{ id: 'home' }] })).toEqual({ position: 'rail', side: 'end', align: 'center', place: 'bottom', items: [{ id: 'home', label: null, hidden: false }] });
    expect(parseNavLayout({ position: 'top', align: 7 }).align).toBe('center');
  });

  it('read the floating pill’s place, at the bottom in the middle unless saved otherwise', () => {
    expect(parseNavLayout({ position: 'dock', place: 'top-end' }).place).toBe('top-end');
    expect(parseNavLayout({ position: 'dock', place: 'bottom-start', side: 'end' })).toEqual({ position: 'dock', side: 'end', align: 'center', place: 'bottom-start', items: [] });
    // A dock saved before it could move stays where it was; an unknown place (a newer Orbit's) keeps the rest.
    expect(parseNavLayout({ position: 'dock', items: [{ id: 'home', hidden: true }] })).toEqual({ position: 'dock', side: 'start', align: 'center', place: 'bottom', items: [{ id: 'home', label: null, hidden: true }] });
    for (const odd of ['middle', 'top-left', 3, null]) expect(parseNavLayout({ position: 'dock', place: odd, align: 'start' })).toEqual({ position: 'dock', side: 'start', align: 'start', place: 'bottom', items: [] });
  });

  it('keep names short, single-line and printable, and items unique', () => {
    const layout = parseNavLayout({ position: 'top', items: [{ id: 'home', label: ' Start\u202e\nhere ' }, { id: 'home', label: 'again' }, { id: 'movie', label: 'x'.repeat(60) }, { id: 'series', label: '   ' }] });
    expect(layout.items).toEqual([
      { id: 'home', label: 'Starthere', hidden: false },
      { id: 'movie', label: 'x'.repeat(24), hidden: false },
      { id: 'series', label: null, hidden: false },
    ]);
    expect(cleanLabel(42)).toBeNull();
  });

  it('arrange saved items over the pages Orbit has', () => {
    const saved = [
      { id: 'library', label: 'Mine', hidden: false },
      { id: 'gone', label: null, hidden: false },
      { id: 'home', label: null, hidden: true },
    ];
    expect(arrangeItems(saved, ['home', 'movie', 'library']).map((i) => i.id)).toEqual(['library', 'home', 'movie']);
    expect(arrangeItems([], ['home', 'movie'])).toEqual([
      { id: 'home', label: null, hidden: false },
      { id: 'movie', label: null, hidden: false },
    ]);
  });

  it('leave the Addons page out of the nav until it’s shown', () => {
    expect(arrangeItems([], ['home', 'addons'])).toEqual([
      { id: 'home', label: null, hidden: false },
      { id: 'addons', label: null, hidden: true },
    ]);
    expect(arrangeItems([{ id: 'addons', label: 'Store', hidden: false }], ['home', 'addons'])).toEqual([
      { id: 'addons', label: 'Store', hidden: false },
      { id: 'home', label: null, hidden: false },
    ]);
  });

  it('move items within the list', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -2)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});
