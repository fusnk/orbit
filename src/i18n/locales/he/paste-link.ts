import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Hebrew strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "הפעלת הקישור הזה",
  'pastelink.play-magnet': "הפעלת קישור המגנט הזה",
  'pastelink.magnet': "קישור מגנט",
  'pastelink.source': "קישור שהודבק",
  'pastelink.detail': "נפתח בנגן. שום דבר לא נשמר בהיסטוריית הצפייה.",
  'pastelink.torrents-off.title': "קישורי מגנט דורשים להפעיל טורנטים",
  'pastelink.torrents-off.detail': "Orbit מפעיל קישורי מגנט בנגן הטורנטים שלו, שכרגע כבוי. אפשר להפעיל טורנטים בהגדרות.",
  'pastelink.torrents-off.open': "פתיחת ההגדרות",
};
