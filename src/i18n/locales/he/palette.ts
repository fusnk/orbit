import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'לוח פקודות',
  'palette.placeholder': 'חיפוש כותרים, הגדרות, תוספים ופעולות',
  // כותרות קבוצה
  'palette.group.recent': 'אחרונים',
  'palette.group.suggested': 'מוצעים',
  'palette.group.yours': 'הדברים שלך',
  'palette.group.titles': 'כותרים',
  'palette.group.settings': 'הגדרות',
  'palette.group.addons': 'תוספים',
  'palette.group.actions': 'פעולות',
  // כותרים מתוספים, תוך כדי הקלדה
  'palette.titles.searching': 'מחפש בתוספים שלך…',
  'palette.titles.none': 'לא נמצאו כותרים',
  'palette.titles.none-can-search': 'אף אחד מהתוספים שלך לא תומך בחיפוש',
  'palette.titles.failed': 'התוספים שלך לא יכולים לחפש כרגע',
  'palette.search-all': 'חיפוש כל התוצאות עבור “{query}”',
  'palette.no-match': 'שום דבר כאן לא מתאים ל-“{query}”',
  // איפה נמצא כותר שלך
  'palette.from.continue': 'המשך צפייה',
  'palette.from.library': 'בספרייה שלך',
  'palette.from.queue': 'בתור שלך',
  'palette.from.downloads': 'הורד',
  'palette.from.watched': 'נצפה',
  'palette.from.list': 'רשימה',
  // מה התוצאה
  'palette.kind.page': 'דף',
  'palette.kind.shortcut': 'קיצור מקלדת · {key}',
  'palette.kind.addon': 'תוסף',
  'palette.kind.category': 'הגדרות',
  'palette.kind.setting': 'הגדרות · {category}',
  'palette.setting-hidden': '“{setting}” יופיע אחרי שמשנים את “{parent}”.',
  'palette.kind.movie': 'סרט',
  'palette.kind.series': 'סדרה',
  'palette.kind.title': 'כותר',
  // פעולות
  'palette.action.profile': 'החלפת פרופיל',
  'palette.action.shortcuts': 'קיצורי מקלדת',
  'palette.action.install-addon': 'התקנת תוסף…',
  'palette.action.addon-updates': 'בדיקת עדכונים לתוספים',
  // רמזי המקשים בתחתית
  'palette.hint.move': 'מעבר',
  'palette.hint.open': 'פתיחה',
  'palette.hint.groups': 'הקבוצה הבאה',
  'palette.hint.close': 'סגירה',
  // מילים נוספות שאנשים עשויים להקליד לכל קטגוריית הגדרות
  'palette.keywords.general': 'שפה הפעלה פתיחה סגירה חלון מגש קנה מידה זום תנועה אפקטים נגישות התראות גיבוי שחזור אבחון יומנים ייבוא trakt letterboxd',
  'palette.keywords.playback': 'הפעלה אוטומטית פרק הבא המשך דילוג פתיח טריילר',
  'palette.keywords.addons': 'התקנה חנות הרחבות פלאגינים מקורות איכות טורנטים הימנעות העדפה',
  'palette.keywords.downloads': 'אופליין אחסון תיקייה איכות הורדות',
  'palette.keywords.appearance': 'ערכת נושא צבעים צבע הדגשה גופן כהה בהיר טפט אווירה לוגו מראות',
  'palette.keywords.shortcuts': 'מקלדת קיצורים מקשים מיפוי',
  'palette.keywords.home-library': 'אנימה בית שורות נצפה המשך ספוילרים קשתות עלילה ספרייה מטא־דאטה',
  'palette.keywords.subtitles': 'כתוביות שפה מאולצות סנכרון לקויי שמיעה מילים גופן גודל צבע',
  'palette.keywords.picture-sound': 'תמונה וידאו פענוח חומרה hdr שמע צליל שפה passthrough עוצמת קול',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord שירותי סטרימינג סנכרון חשבון debrid tmdb שילובים iptv שידור חי ערוצים m3u xtream מדריך',
  // הגדרות → קיצורים
  'palette.shortcut': 'לוח פקודות',
};
