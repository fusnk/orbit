import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // שורה אחת מתחת לכותרת של כל קטגוריה
  'settingshome.intro.general': 'שפה, איך Orbit נפתח ונסגר, נוחות, התראות וגיבויים.',
  'settingshome.intro.addons': 'מאיפה מגיעים הקטלוגים והמקורות שלך, ואיך Orbit בוחר מקור.',
  'settingshome.intro.downloads': 'מה Orbit שומר במחשב הזה לצפייה אופליין.',
  'settingshome.intro.shortcuts': 'כל מקש ש-Orbit מגיב אליו, ומה הוא עושה.',
  'settingshome.intro.home-library': 'השורות בדף הבית, המשך צפייה וספוילרים.',
  'settingshome.intro.subtitles': 'שפת הכתוביות שלך ואיך הכתוביות נראות.',
  'settingshome.intro.picture-sound': 'התמונה, החומרה שעושה את העבודה, ואיך הצליל מגיע אליך.',
  'settingshome.intro.accounts': 'חשבונות ושירותים ש-Orbit יכול לעבוד איתם, ומקורות השידור החי שלך.',
  // חיפוש בהגדרות (פותח את לוח הפקודות בהגדרות)
  'settingshome.search.button': 'חיפוש בהגדרות',
  'settingshome.search.placeholder': 'חיפוש בהגדרות',
  'settingshome.search.none': 'אין הגדרות תואמות.',
  // שורות השירותים בכותרת הפרופיל
  'settingshome.connections': 'שירותים מחוברים',
  'settingshome.stremio.signed-in': 'Stremio · מחובר',
  'settingshome.stremio.synced': 'Stremio · סונכרן {when}',
  'settingshome.stremio.synced-now': 'Stremio · סונכרן זה עתה',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // שורת השמירה
  'settingshome.saved': 'נשמר',
  'settingshome.saved-announce': 'ההגדרה נשמרה',
  // הגדרות → כללי → אודות Orbit
  'settingshome.about.heading': 'אודות Orbit',
  'settingshome.about.version': 'גרסה {version}',
  'settingshome.about.made-by': 'נוצר על ידי {name}',
  'settingshome.about.licence': 'תוכנה חופשית · {licence}',
  'settingshome.about.source': 'קוד מקור',
  'settingshome.about.licences': 'רישיונות קוד פתוח',
  'settingshome.about.legal-heading': 'מידע משפטי',
  'settingshome.about.legal-independent': 'Orbit היא אפליקציה עצמאית בקוד פתוח. היא לא קשורה ל-Stremio, ולא מאושרת או ממומנת על ידה או על ידי מפתח תוסף, שירות או חברה כלשהם שמוזכרים באפליקציה. {names} וכל שם ולוגו אחר שמוצגים שייכים לבעליהם ומופיעים רק כדי לציין עם מה Orbit עובד.',
  'settingshome.about.legal-content': 'Orbit לא מארח, משתף או מאנדקס מדיה כלשהי. כל מה שמפעילים מגיע מתוספים, שירותים או שרתים שהגדרת בעצמך, והאחריות למה שמפעילים ולשמירה על החוק במקום מגוריך היא שלך.',
  // הגדרות → כללי → אודות Orbit: עדכונים, והבאנר כשעדכון מוכן
  'settingshome.updates.label': 'עדכונים',
  'settingshome.updates.check': 'בדיקת עדכונים',
  'settingshome.updates.idle': 'Orbit בודק פעם ביום ושואל לפני ההתקנה.',
  'settingshome.updates.idle-manual': 'Orbit בודק רק כשמבקשים, ושואל לפני ההתקנה.',
  'settingshome.updates.idle-auto': 'Orbit בודק פעם ביום ומתקין עדכון כשיוצאים ממנו.',
  'settingshome.updates.idle-manual-auto': 'Orbit בודק רק כשמבקשים, ומתקין עדכון כשיוצאים ממנו.',
  'settingshome.updates.checking': 'בודק עדכונים…',
  'settingshome.updates.up-to-date': 'Orbit מעודכן.',
  'settingshome.updates.downloading': 'מוריד את Orbit {version}…',
  'settingshome.updates.failed': 'לא הצלחנו לבדוק עדכונים. אפשר לנסות שוב מאוחר יותר.',
  'settingshome.updates.download-failed': 'לא הצלחנו להוריד את Orbit {version}. Orbit ינסה שוב מאוחר יותר.',
  'settingshome.updates.off': 'העדכונים כבויים בגרסה הזו.',
  'settingshome.updates.ready': 'Orbit {version} מוכן',
  'settingshome.updates.restart': 'הפעלה מחדש לעדכון',
  'settingshome.updates.later': 'אחר כך',
  'settingshome.updates.install-failed': 'לא הצלחנו להתקין את העדכון. אפשר לנסות שוב מאוחר יותר.',
  'settingshome.updates.auto': 'עדכון אוטומטי',
  'settingshome.updates.auto-hint': 'מתקין עדכון שהורד כשיוצאים מ-Orbit. כשכבוי, Orbit רק מודיע.',
  'settingshome.updates.check-auto': 'בדיקת עדכונים אוטומטית',
  'settingshome.updates.check-auto-hint': 'מחפש גרסה חדשה פעם ביום. כשהאפשרות כבויה, Orbit בודק רק כשבוחרים ב„בדיקת עדכונים”.',
  // מוצג פעם אחת אחרי עדכון
  'settingshome.whats-new.heading': 'מה חדש ב-Orbit {version}',
  'settingshome.whats-new.plain': 'Orbit עודכן לגרסה {version}.',
  'settingshome.whats-new.close': 'הבנתי',
};
