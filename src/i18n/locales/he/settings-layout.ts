import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Hebrew strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'איך הנגן נראה, איך הפקדים שלו מתנהגים, ונגנים אחרים.',
  'settingslayout.intro.playback': 'לחיצה על הפעלה, הפרק הבא, דילוגים וטריילרים.',
  'settingslayout.intro.appearance': 'מראות, צבעים, התפריט, רקעים, דפי כותרים ופוסטרים.',
  'settingslayout.keywords.player': 'נגן פריסה פקדים פס התקדמות קפיצה עוצמת קול הגברה מזעור מסך מלא תצוגות מקדימות הרצה אחורה חיצוני vlc mpv',
  'settingslayout.chapter.library': 'ספרייה',
  'settingslayout.chapter.starting': 'התחלת סרטון',
  'settingslayout.chapter.skip-tuning': 'כוונון עדין של דילוגים',
  'settingslayout.chapter.player-look': 'מראה',
  'settingslayout.chapter.player-controls': 'פקדים',
  'settingslayout.chapter.player-window': 'חלון ותוספות',
  'settingslayout.chapter.subtitle-text': 'שפה וטקסט',
  'settingslayout.chapter.choosing-source': 'בחירת מקור',
  'settingslayout.chapter.ranking-rules': 'כללי סדר',
  'settingslayout.preview': 'תצוגה מקדימה',
  'settingslayout.none': 'ללא',
};
