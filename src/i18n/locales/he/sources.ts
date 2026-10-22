import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // הגדרות → ניגון → מגבלות הפעלה אוטומטית (לכל פרופיל)
  'sources.limits.heading': 'מגבלות הפעלה אוטומטית',
  'sources.limits.any': 'כל איכות',
  'sources.limits.min-quality': 'לא להפעיל אוטומטית מתחת ל',
  'sources.limits.min-quality-hint': 'הפעלה והפרק הבא מתחילים רק מקורות טובים לפחות כמו זה (מקורות שלא מציינים איכות לא נכללים). אם אף אחד לא מתאים, הטוב ביותר מתנגן ו-Orbit מודיע. רשימת המקורות עדיין מציגה הכול. לפרופיל הזה.',
  'sources.limits.max-quality': 'לא להפעיל אוטומטית מעל',
  'sources.limits.max-quality-hint': 'הפעלה והפרק הבא לא מתחילים מקורות מעל האיכות הזו, אלא אם לא נמצא שום דבר אחר. בניגוד ל“האיכות הגבוהה ביותר להעדיף”, זה לא משנה את סדר רשימת המקורות. לפרופיל הזה.',
  'sources.limits.max-size': 'לא להפעיל אוטומטית קבצים גדולים מ',
  'sources.limits.max-size-hint': 'לחיבורים איטיים או למכסות נתונים: הפעלה והפרק הבא מדלגים על קבצים גדולים יותר. מקורות שלא מציינים גודל לא מושפעים. לפרופיל הזה.',
  // הודעות כשמקור נבחר אוטומטית
  'sources.autoplay.outside-limits': 'שום דבר לא מתאים למגבלות ההפעלה האוטומטית שלך, לכן מתנגן המקור הטוב ביותר.',
  'sources.autoplay.only-uncached': 'כל המקורות שנמצאו עדיין יורדים לשירות ה-Debrid שלך. אפשר לבחור אחד כדי להתחיל אותו.',
  // תגיות שקטות ברשימת המקורות
  'sources.note.uncached': 'לא במטמון',
  'sources.note.uncached-hint': 'עדיין יורד לשירות ה-Debrid שלך: אף פעם לא מתחיל אוטומטית',
  'sources.note.outside-limits': 'מחוץ למגבלות ההפעלה האוטומטית',
  'sources.note.outside-limits-hint': 'הפעלה והפרק הבא מדלגים עליו (הגדרות ← תוספים ומקורות ← העדפות מקורות ← מגבלות הפעלה אוטומטית)',
  // כרטיס הבא בתור, לפרק שתאריך השידור שלו לא אושר
  'sources.next-up.unaired': 'הבא בתור · תאריך השידור לא אושר',
};
