import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Hebrew strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "לעדכן את ההגדרות של התוסף הזה?",
  'prfixes.addons.update-detail': "{name} כבר מותקן. ההגדרות האלה מחליפות את הישנות, והוא שומר על מקומו ברשימה שלך.",
  'prfixes.addons.update': "עדכון",
  'prfixes.audio.original': "קודם השפה המקורית",
  'prfixes.audio.original-hint': "כל סרט או סדרה מתחילים בשפה שבה הם נוצרו, כשיש לסרטון את השמע הזה: אנימה ביפנית, דרמה קוריאנית בקוריאנית. אחרת, שפת השמע שלמעלה. נדרש מפתח TMDB.",
  'prfixes.bundle.local': "הכתובת הזו מובילה למחשב הזה או לרשת הביתית שלך, ולכן Orbit לא פנה אליה.",
};
