import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Hebrew strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'עיון',
  'remote.phone.browse-loading': 'טוען את דף הבית…',
  'remote.phone.browse-empty': 'אין עדיין מה להציג. אפשר להוסיף תוסף קטלוג ב-Orbit כדי למלא את דף הבית.',
  'remote.phone.browse-failed': 'לא ניתן לטעון את דף הבית. אפשר לנסות שוב.',
  'remote.phone.refresh': 'רענון',
  'remote.phone.moods': 'למה יש לך מצב רוח?',
  'remote.phone.mood-loading': 'מחפש הצעות…',
  'remote.phone.mood-empty': 'אין כרגע הצעות למצב הרוח הזה.',
  'remote.phone.surprise': 'הפתעה',
  'remote.phone.surprise-hint': 'הצעה אקראית אחת מהקטלוגים שלך.',
  'remote.phone.surprise-movie': 'סרט',
  'remote.phone.surprise-series': 'סדרה',
  'remote.phone.surprise-none': 'אין כרגע משהו חדש להציע. אפשר לנסות את הסוג השני, או לשנות את הבחירות של „הפתעה” ב-Orbit.',
  'remote.phone.details-loading': 'טוען פרטים…',
  'remote.phone.details-failed': 'לא ניתן לטעון את הכותר הזה. אפשר לנסות שוב.',
  'remote.phone.add-library': 'הוספה לספרייה',
  'remote.phone.in-library': 'בספרייה שלך',
  'remote.phone.close': 'סגירה',
  'remote.phone.season': 'עונה {number}',
  'remote.phone.specials': 'פרקים מיוחדים',
  'remote.phone.episodes': 'פרקים',
  'remote.phone.rating': 'דירוג IMDb ‏{rating}',
};
