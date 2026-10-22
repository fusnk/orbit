import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // מרכז ההגדרות
  'playerplus.hub.title': 'הגדרות',
  'playerplus.hub.back': 'חזרה אל {to}',
  'playerplus.hub.picture': 'איכות ותמונה',
  'playerplus.hub.sound': 'צליל',
  'playerplus.hub.speed-note': 'החזקת {key} מפעילה במהירות כפולה כל עוד מחזיקים.',
  'playerplus.hub.no-audio': 'אין עדיין רצועות שמע. הן יופיעו אחרי שהסרטון ייטען.',
  'playerplus.hub.timing-sub': 'כתוביות {delay}',
  'playerplus.hub.timing-audio': 'שמע {delay}',
  'playerplus.hub.timing-none': 'לא כוונן',

  // תזמון כתוביות לפי מה ששמת לב אליו
  'playerplus.timing.heard-first': 'שמעתי קודם',
  'playerplus.timing.heard-first-hint': 'הכתוביות מאחרות: להציג אותן מוקדם יותר',
  'playerplus.timing.saw-first': 'ראיתי קודם',
  'playerplus.timing.saw-first-hint': 'הכתוביות מקדימות: להציג אותן מאוחר יותר',
  'playerplus.timing.earlier-by': 'הצגת הכתוביות {value} שנ׳ מוקדם יותר',
  'playerplus.timing.later-by': 'הצגת הכתוביות {value} שנ׳ מאוחר יותר',

  // צליל
  'playerplus.sound.off': 'מקורי',
  'playerplus.sound.off-hint': 'הצליל כפי שנמהל.',
  'playerplus.sound.cinema': 'קולנוע',
  'playerplus.sound.cinema-hint': 'בס מלא יותר וקצת יותר מרחב, לסרטים בעוצמה טובה.',
  'playerplus.sound.music': 'מוזיקה',
  'playerplus.sound.music-hint': 'בס חם יותר וגבוהים בהירים יותר, להופעות ולמחזות זמר.',
  'playerplus.sound.dialogue': 'דיאלוג ברור',
  'playerplus.sound.dialogue-hint': 'הקולות מובלטים מעל המוזיקה והאפקטים.',
  'playerplus.sound.note': 'אחד בכל פעם. נשמר לכל הסרטונים.',

  // חיפוש מקור חי
  'playerplus.search.label': 'מחפש מקור עבור {name}',
  'playerplus.search.finding': 'מאתר תוספים…',
  'playerplus.search.asking': 'שואל…',
  'playerplus.search.sources.one': '{count} מקור',
  'playerplus.search.sources.other': '{count} מקורות',
  'playerplus.search.none': 'אין תוצאות',
  'playerplus.search.failed': 'לא ענה',
  'playerplus.search.progress.one': '{count} מתוך {total} תוספים ענה · {found} מקורות עד עכשיו',
  'playerplus.search.progress.other': '{count} מתוך {total} תוספים ענו · {found} מקורות עד עכשיו',

  // תצוגת הזמן
  'playerplus.time.finish': 'נותרו {left} · מסתיים ב-{time}',

  // רצועות בפס ההתקדמות
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'פתיח',
  'playerplus.bands.recap': 'תקציר',
  'playerplus.bands.credits': 'כתוביות',
  'playerplus.bands.preview': 'פרומו',

  // דילוגים
  'playerplus.skip.preview': 'דילוג על הפרומו',
  'playerplus.skip.skipped-credits': 'דילגנו על הכתוביות',
  'playerplus.skip.skipped-preview': 'דילגנו על הפרומו',

  // בועת הקפיצה
  'playerplus.bubble.ahead': '+{seconds} שנ׳',
  'playerplus.bubble.back': '−{seconds} שנ׳',

  // רשימת הקיצורים
  'playerplus.cheat.action': 'הצגת קיצורי הנגן',
  'playerplus.cheat.title': 'קיצורי הנגן',
  'playerplus.cheat.playback': 'הפעלה',
  'playerplus.cheat.sound': 'צליל וכתוביות',
  'playerplus.cheat.window': 'תמונה וחלון',
  'playerplus.cheat.fixed': 'תמיד',
  'playerplus.cheat.no-key': 'ללא מקש',
  'playerplus.cheat.hold': 'החזקת {key}',
  'playerplus.keys.number-jump': 'קפיצה ל-0–90% מהסרטון',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'מהירות כפולה בזמן החזקה',
  'playerplus.keys.hold-boost-keys': 'החזקת {key}',

  // נעילה
  'playerplus.lock.action': 'נעילת הפקדים',
  'playerplus.lock.unlock': 'ביטול הנעילה',
  'playerplus.lock.hint': 'הפקדים נעולים. לחיצה על Esc שלוש פעמים תבטל את הנעילה.',
  'playerplus.lock.hint-key': 'הפקדים נעולים. לחיצה על {key}, או על Esc שלוש פעמים, תבטל את הנעילה.',
  'playerplus.lock.unlocked': 'נעילת הפקדים בוטלה',

  // פרקים מעוגנים
  'playerplus.dock.collapse': 'הסתרת הפרקים',
  'playerplus.dock.expand': 'הצגת הפרקים',
  'playerplus.dock.number': 'E{number}',

  // הגדרות → נגן והפעלה
  'playerplus.settings.hold-boost': 'החזקה למהירות כפולה',
  'playerplus.settings.hold-boost-hint': 'החזקת מקש ההפעלה/השהיה מפעילה במהירות כפולה עד שעוזבים. לחיצה קצרה עדיין משהה.',
  'playerplus.settings.number-jump': 'קפיצה במקשי מספרים',
  'playerplus.settings.number-jump-hint': '1 קופץ ל-10% מהסרטון, 5 לאמצע, 0 להתחלה. מקשים שהוקצה להם קיצור אחר שומרים עליו.',
  'playerplus.settings.grayscale': 'שחור-לבן בהשהיה',
  'playerplus.settings.grayscale-hint': 'התמונה המושהית דוהה לאפור; הצבע חוזר כשהיא מתנגנת.',
  'playerplus.settings.episodes': 'רשימת הפרקים',
  'playerplus.settings.episodes-hint': 'צף נפתח מעל הפקדים. מעוגן משאיר רשימה בצד שמתקפלת ללשונית קטנה.',
  'playerplus.settings.episodes-floating': 'צף',
  'playerplus.settings.episodes-docked': 'מעוגן',
  'playerplus.settings.skipping': 'דילוגים',
  'playerplus.settings.skipping-hint': 'כפתור מציג דילוג בזמן שזה מתנגן; אוטומטי מדלג בלי לשאול (פעם אחת: אפשר לחזור אחורה כדי לצפות).',
  'playerplus.settings.skip-intro': 'פתיחים',
  'playerplus.settings.skip-recap': 'תקצירים',
  'playerplus.settings.skip-credits': 'כתוביות סיום',
  'playerplus.settings.skip-preview': 'פרומו אחרי הכתוביות',
  'playerplus.settings.skip-off': 'כבוי',
  'playerplus.settings.skip-button': 'כפתור',
  'playerplus.settings.skip-auto': 'אוטומטי',
  'playerplus.settings.learn-skips': 'ללמוד איפה אני מדלג על פתיחים',
  'playerplus.settings.learn-skips-hint': 'אחרי דילוג ידני על פתיח בסדרה, הפרקים הבאים שלה יציעו דילוג על הפתיח באותו זמן, כשלא ידועים זמני דילוג אחרים. נשמר במכשיר הזה, לפרופיל הזה.',
  'playerplus.settings.forget-skips': 'זמני פתיח שנלמדו',
  'playerplus.settings.forget-skips-hint': 'שוכח את זמני הפתיח שנלמדו לכל הסדרות בפרופיל הזה.',
  'playerplus.settings.forget-skips-action': 'שכחה',
  'playerplus.settings.forget-skips-done': 'זמני הפתיח שנלמדו נשכחו',
};
