import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // נגן → שמע וכתוביות: כתוביות מתוסף שנוצרו לגרסה שמתנגנת
  'subs.best-match': 'ההתאמה הטובה ביותר',
  'subs.error.sdh': 'לא הצלחנו להחיל את הגדרת הטקסט לכבדי שמיעה',
  // הגדרות → שמע וכתוביות
  'subs.settings.strip-sdh': 'הסרת טקסט לכבדי שמיעה',
  'subs.settings.strip-sdh-hint': 'מסתיר מהכתוביות תיאורי צלילים כמו [הדלת חורקת], סימני מוזיקה ושמות דוברים כמו JOHN:. שורות שנשארות ריקות מדולגות; התזמון נשאר זהה.',
  'subs.settings.keep-lyrics': 'שמירת מילות שירים',
  'subs.settings.keep-lyrics-hint': 'שורות מושרות שמסומנות ב-♪ נשארות כשמסירים טקסט לכבדי שמיעה. שורות עם תווים בלבד עדיין יוסרו.',
  // נגן → שמע וכתוביות → מיקום הכתוביות
  'subs.error.override': 'לא הצלחנו להשאיר את הכתוביות למטה',
  'subs.player.position': 'מיקום הכתוביות',
  'subs.player.height': 'גובה',
  'subs.player.raised': 'למעלה {value}%',
  'subs.player.reset': 'החזרה למטה',
  'subs.player.keep-bottom': 'להשאיר למטה',
  'subs.player.keep-bottom-hint': 'כתוביות פשוטות (כמו SRT) מתעלמות מהמיקום שבקובץ, כך שכל שורה יושבת בגובה הזה. כתוביות פשוטות בתוך הסרטון מאבדות גם את הנטוי. כתוביות מעוצבות (ASS, נפוצות באנימה) שומרות על הפריסה שלהן. נשמר לכל הסרטונים.',
};
