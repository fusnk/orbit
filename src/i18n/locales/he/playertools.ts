import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'מותאם אישית',
  'playertools.speed.custom-label': 'מהירות מותאמת אישית',
  'playertools.speed.slower': 'לאט יותר (−0.05×)',
  'playertools.speed.faster': 'מהר יותר (+0.05×)',
  'playertools.subs.try-another': 'ניסיון כתוביות אחרות',
  'playertools.subs.try-another-detail': 'ההתאמה הטובה הבאה ב{language}',
  'playertools.subs.cycled': 'כתוביות {position} מתוך {total} · {source}',
  'playertools.subs.no-other': 'אין כתוביות אחרות לנסות',
  'playertools.paste.action': 'הדבקת כתוביות…',
  'playertools.paste.detail': 'טקסט SRT או WebVTT',
  'playertools.paste.title': 'הדבקת כתוביות',
  'playertools.paste.hint': 'יש להדביק את הטקסט של קובץ SRT או WebVTT. הוא יתווסף לסרטון הזה בלבד.',
  'playertools.paste.field': 'טקסט הכתוביות',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nשלום!',
  'playertools.paste.add': 'הוספת כתוביות',
  'playertools.paste.cancel': 'ביטול',
  'playertools.paste.empty': 'קודם יש להדביק טקסט כתוביות.',
  'playertools.paste.too-big': 'זה יותר מ-2 MB של טקסט.',
  'playertools.paste.bad': 'זה לא נראה כמו כתוביות SRT או WebVTT.',
  'playertools.paste.added': 'הכתוביות שהודבקו נוספו',
  'playertools.paste.name': 'כתוביות שהודבקו',
  'playertools.caps.setting': 'תיקון כתוביות באותיות גדולות',
  'playertools.caps.hint': 'שורות שנכתבו כולן באותיות לטיניות גדולות יומרו לאותיות רגילות. עובד על כתוביות מתוספים, קבצים שנוספו וטקסט שהודבק, לא על כתוביות שבתוך קובץ הווידאו. גם שמות מאבדים את האות הגדולה.',
  'playertools.caps.error': 'לא הצלחנו להחיל את הגדרת האותיות הגדולות',
};
