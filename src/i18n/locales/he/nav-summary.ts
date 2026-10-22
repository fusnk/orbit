import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Hebrew strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} ועוד {count}',
  'navsummary.scale': 'קנה מידה {percent}',
  'navsummary.size': 'גודל {percent}',
  'navsummary.banner': 'באנר: {style}',
  'navsummary.watched-at': 'נצפה ב-{percent}',
  'navsummary.spoilers-hidden': 'ספוילרים מוסתרים',
  'navsummary.spoilers-shown': 'ספוילרים מוצגים',
  'navsummary.autoplay': 'הפעלה אוטומטית: {mode}',
  'navsummary.player-layout': 'פריסה: {name}',
  'navsummary.no-addons': 'אין תוספים',
  'navsummary.not-connected': 'שום דבר לא מחובר עדיין',
  'navsummary.downloads.none': 'אין הורדות עדיין',
  'navsummary.downloads.done.one': 'הורדו: {count}',
  'navsummary.downloads.done.other': 'הורדו: {count}',
  'navsummary.downloads.active.one': 'בתהליך: {count}',
  'navsummary.downloads.active.other': 'בתהליך: {count}',
  'navsummary.shortcuts.one': '{count} קיצור מקלדת',
  'navsummary.shortcuts.other': '{count} קיצורי מקלדת',
};
