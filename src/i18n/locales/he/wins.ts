import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

export const wins: Catalog<typeof source> = {
  // מסנני הגילוי: טווח שנים, אורך, שחקנים ובמאי
  'explore.filters.year-from': 'משנה',
  'explore.filters.year-to': 'עד שנה',
  'explore.filters.runtime': 'אורך',
  'explore.filters.runtime-min': 'לפחות',
  'explore.filters.runtime-max': 'לכל היותר',
  'explore.filters.minutes': '{count} דק׳',
  'explore.filters.cast': 'שחקנים',
  'explore.filters.director': 'במאי או צוות',
  'explore.filters.person-search': 'חיפוש אנשים: {what}',
  'explore.filters.person-placeholder': 'הקלדת שם',
  'explore.filters.person-none': 'לא נמצא אף אחד',
  'explore.filters.person-clear': 'הסרת {name}',
  // הגדרות → ניגון → מטמון להרצה אחורה
  'settings.player.rewind': 'מטמון להרצה אחורה',
  'settings.player.rewind-hint': 'כמה מהסרטון נשאר בזיכרון, כדי שקפיצה אחורה תהיה מיידית. יותר משתמש בעד כ-600 MB של RAM בזמן ניגון, הכי הרבה בעד כ-1.5 GB. חל מהסרטון הבא.',
  'settings.player.rewind-standard': 'רגיל',
  'settings.player.rewind-more': 'יותר',
  'settings.player.rewind-most': 'הכי הרבה',
  // הגדרות → כתוביות: אטימות, צבעי תיבה ומתאר
  'subs.style.opacity': 'אטימות הטקסט',
  'subs.style.box-colour': 'צבע התיבה',
  'subs.style.box-opacity': 'אטימות התיבה',
  'subs.style.box-opacity-hint': 'לתיבה יש פינות ישרות: הנגן לא יכול לצייר פינות מעוגלות.',
  'subs.style.outline-colour': 'צבע המתאר',
  'player.subtitle-style.black': 'שחור',
  'player.subtitle-style.grey': 'אפור',
  'player.subtitle-style.navy': 'כחול כהה',
  // תוספים: מצב, ספירות ורענון מניפסט
  'addons.health.no-answer': 'לא ענה',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} מותקן',
  'addons.health.installed.other': '{count} מותקנים',
  'addons.health.enabled.one': '{count} מופעל',
  'addons.health.enabled.other': '{count} מופעלים',
  'addons.health.refresh': 'רענון התוסף',
  'addons.health.refreshing': 'מרענן את {name}…',
  'addons.health.refreshed': '{name} עודכן.',
  'addons.health.unchanged': '{name} ענה: שום דבר לא השתנה.',
  'addons.health.refresh-failed': '{name} לא ענה. Orbit ממשיך להשתמש במה שהיה לו.',
  // העדפות מקורות: גודל מינימלי
  'sources.rules.min-size': 'גודל מינימלי',
  'sources.rules.min-size-hint': 'לסרטים; פרקים מקבלים שליש ממנו. קבצים קטנים יותר, לרוב מזויפים או עותקים מצולמים, מגיעים אחרי כל האחרים, אבל אף פעם לא מוסתרים. מקורות שלא מציינים גודל לא מושפעים.',
  'titles.why.under-size': 'מתחת למינימום של {size} GB שלך',
  // חיפוש באוספים
  'collections.search.label': 'חיפוש אוסף',
  'collections.search.placeholder': 'חיפוש אוסף',
  'collections.search.none': 'אין אוסף תואם',
  'collections.search.none-detail': 'החיפוש עובר על שמות וקבוצות.',
  'collections.search.titles-label': 'חיפוש כותר באוסף הזה',
  'collections.search.titles-placeholder': 'חיפוש כותר',
  'collections.search.no-titles': 'אין כאן כותר תואם',
  // רדאר השקות → ייצוא ללוח שנה
  'radar.export': 'ייצוא ללוח שנה (.ics)',
  'radar.export.hint': 'שומר את מה שהרדאר מציג כקובץ שכל אפליקציית לוח שנה יכולה לייבא.',
  'radar.export.name': 'רדאר ההשקות של Orbit',
  // דילוגים אוטומטיים אחרי השהיה
  'playerplus.skip.auto-in': '{label} בעוד {seconds}',
  'playerplus.settings.skip-delay': 'המתנה לפני דילוג אוטומטי',
  'playerplus.settings.skip-delay-hint': 'בקטעים שמוגדרים לאוטומטי: כפתור הדילוג סופר קודם לאחור. לחיצה על מקש כלשהו עוצרת אותו כדי לצפות.',
  'playerplus.settings.skip-delay-none': 'בלי המתנה',
};
