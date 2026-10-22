import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': 'תצוגה מקדימה',
  'subfonts.preview-hint': 'דוגמה של הכתוביות שלך, כפי שהנגן מצייר אותן. הגדלים והמתארים קרובים, אבל לא זהים לגמרי, למה שהנגן מציג.',
  'subfonts.fullscreen': 'תצוגה מקדימה במסך מלא',
  'subfonts.fullscreen-close': 'לסגירה: Esc או לחיצה',
  'subfonts.line1': 'לא חשבתי שנגיע עד לכאן.',
  'subfonts.line2': 'גם אני לא. בוא נמשיך.',
  'subfonts.font': 'גופן',
  'subfonts.font-label': 'גופן הכתוביות',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend ו-OpenDyslexic נועדו לקריאה קלה יותר; הם מגיעים עם Orbit. כתוביות מעוצבות שומרות על הגופן שלהן.',
  'subfonts.default': 'ברירת מחדל',
};
