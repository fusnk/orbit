import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Hebrew strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "בחירה בשבילי",
  'librarylook.pick.title': "בחירה מהספרייה שלי",
  'librarylook.pick.none-type': "עדיין אין בספרייה שלי שום דבר מהסוג הזה.",
  'librarylook.pick.none-body': "שום דבר בספרייה שלי לא מתאים לבחירות האלה. אפשר לנסות להרחיב אותן.",
  'librarylook.stremio.body': "צופים גם ב-Stremio? אחרי ההתחברות, המשך הצפייה והכותרים שצפית בהם יעברו איתך.",
  'librarylook.stremio.sign-in': "התחברות ל-Stremio",
};
