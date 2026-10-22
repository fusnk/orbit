import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

export const pstreamPlayer: Catalog<typeof source> = {
  // קיצורי מהירות ודילוג עדין
  'pstream.keys.speed-down': 'לאט יותר',
  'pstream.keys.speed-up': 'מהר יותר',
  'pstream.keys.seek-back-small': 'שנייה אחורה (פריים אחד בהשהיה)',
  'pstream.keys.seek-forward-small': 'שנייה קדימה (פריים אחד בהשהיה)',
  // מסך ההשהיה
  'pstream.pause.ends': 'מסתיים ב-{time}',
  // ביטול אחרי דילוג
  'pstream.skip.back': 'חזרה ל-{time}',
  // קטעים לדילוג בתצוגת הפרקים בסרטון
  'pstream.chapters.segments': 'קטעים שאפשר לדלג עליהם',
  'pstream.chapters.to-end': '{from} – הסוף',
  // חלונית הפרקים והרשימה המעוגנת
  'pstream.episodes.mark-watched': 'סימון {episode} כנצפה',
  'pstream.episodes.mark-unwatched': 'סימון {episode} כלא נצפה',
  'pstream.episodes.watched': 'נצפה',
  // שורות כתוביות מתוספים
  'pstream.subs.sdh': 'לכבדי שמיעה',
  'pstream.subs.match-good': 'התאמה טובה',
  'pstream.subs.match-fair': 'התאמה סבירה',
  'pstream.subs.match-poor': 'התאמה חלשה',
  // הקלדת תזמון
  'pstream.timing.field': '{name}, בשניות',
  'pstream.timing.type': '{name}: {value}. הפעלה מאפשרת להקליד ערך',
  'pstream.timing.invalid': 'יש להקליד שניות, למשל 1.5 או -2',
  // תזמון כתוביות נשמר לכל קובץ כתוביות
  'pstream.timing.reset': 'תזמון הכתוביות אופס לכתוביות החדשות',
  // סגנון כתוביות בנגן
  'pstream.style.title': 'סגנון הכתוביות',
  'pstream.style.position': 'מיקום',
  'pstream.style.custom': 'מותאם אישית…',
  'pstream.style.hex': 'קוד צבע, למשל #ffcc00',
  'pstream.style.caps-note': 'חל על כתוביות שיתווספו מעכשיו.',
  'pstream.style.more': 'אטימות הטקסט, צבע התיבה ואטימותה וצבע המתאר נמצאים בהגדרות ← כתוביות.',
  // מסך שגיאת ההפעלה
  'pstream.error.retry': 'ניסיון נוסף',
  'pstream.error.retry-at': 'ניסיון נוסף מ-{time}',
  'pstream.error.copy': 'העתקת הפרטים',
  'pstream.error.copied': 'הפרטים הועתקו. כתובות ומפתחות הושמטו.',
  'pstream.error.copy-failed': 'לא הצלחנו להעתיק את הפרטים',
  // הגדרות ← נגן
  'pstream.settings.double-click': 'לחיצה כפולה בצדדים לקפיצה',
  'pstream.settings.double-click-hint': 'לחיצה כפולה על השליש השמאלי או הימני של התמונה קופצת אחורה או קדימה באורך הקפיצה. האמצע עדיין מחליף מסך מלא.',
};
