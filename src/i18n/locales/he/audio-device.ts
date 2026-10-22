import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Hebrew strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "התקן פלט",
  'audiodevice.hint': "היכן הצליל מושמע. ברירת המחדל של המערכת עוקבת אחר בחירת המחשב, גם אם היא משתנה במהלך סרטון. אם ההתקן שנבחר כאן מנותק, הצליל עובר לברירת המחדל של המערכת עד שהוא חוזר.",
  'audiodevice.default': "ברירת המחדל של המערכת",
  'audiodevice.missing': "לא מחובר: מושמע בברירת המחדל של המערכת",
  'audiodevice.error': "לא ניתן היה לשנות את התקן הפלט",
};
