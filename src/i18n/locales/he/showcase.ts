import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // הגדרות → מראה → דף הכותר.
  'showcase.setting.label': 'דף הכותר',
  'showcase.setting.hint': 'קלאסי שומר את התמונה בכרטיס. Showcase פורש אותה על כל החלון, עם הפרטים במקטעים מתחתיה.',
  'showcase.setting.classic': 'קלאסי',
  'showcase.setting.showcase': 'Showcase',
  // החלק העליון.
  'showcase.start-episode': 'התחלת S{season} · E{episode}',
  'showcase.ends-at': 'מסתיים ב-{time}',
  'showcase.ends-at-hint': 'מתי זה יסתיים אם מתחילים עכשיו',
  'showcase.age-rating': 'סיווג {rating}',
  'showcase.streaming-on': 'זמין ב-{provider}',
  // פרקים.
  'showcase.choose-season': 'עונה',
  'showcase.choose-arc': 'קשת עלילתית',
  'showcase.episode-count.one': '{count} פרק',
  'showcase.episode-count.other': '{count} פרקים',
  'showcase.episode-length': '{number} · {minutes} דק׳',
  'showcase.season-actions': 'פעולות לעונה',
  'showcase.download-season.one': 'הורדת העונה ({count} פרק)',
  'showcase.download-season.other': 'הורדת העונה ({count} פרקים)',
  // מקטעים.
  'showcase.extras': 'טריילרים ותוספות',
  'showcase.cast-crew': 'שחקנים וצוות',
  'showcase.photos': 'תמונות',
  'showcase.stills': 'תמונות מהסרט',
  'showcase.topics': 'נושאים',
  'showcase.topic-intro': 'סרטים וסדרות ש-TMDB מתייג בנושא “{topic}”.',
  'showcase.where-to-watch': 'איפה לצפות',
  'showcase.stream': 'סטרימינג',
  'showcase.rent': 'השכרה',
  'showcase.buy': 'קנייה',
  'showcase.justwatch': 'נתונים מ-JustWatch',
  'showcase.releases': 'תאריכי יציאה',
  'showcase.cinemas-only': 'בינתיים רק בבתי הקולנוע — עותקים מוקדמים הם בדרך כלל הקלטות מהאולם.',
};
