import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Arabic strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'تصفّح',
  'remote.phone.browse-loading': 'جارٍ تحميل صفحتك الرئيسية…',
  'remote.phone.browse-empty': 'لا شيء لعرضه بعد. أضف إضافة كتالوج في Orbit لملء الصفحة الرئيسية.',
  'remote.phone.browse-failed': 'تعذّر تحميل صفحتك الرئيسية. حاول مرة أخرى.',
  'remote.phone.refresh': 'تحديث',
  'remote.phone.moods': 'ما الذي تودّ مشاهدته؟',
  'remote.phone.mood-loading': 'جارٍ البحث عن اقتراحات…',
  'remote.phone.mood-empty': 'لا اقتراحات لهذا المزاج الآن.',
  'remote.phone.surprise': 'فاجئني',
  'remote.phone.surprise-hint': 'اقتراح عشوائي واحد من كتالوجاتك.',
  'remote.phone.surprise-movie': 'فيلم',
  'remote.phone.surprise-series': 'مسلسل',
  'remote.phone.surprise-none': 'لا جديد لاقتراحه الآن. جرّب النوع الآخر، أو غيّر اختيارات «فاجئني» في Orbit.',
  'remote.phone.details-loading': 'جارٍ تحميل التفاصيل…',
  'remote.phone.details-failed': 'تعذّر تحميل هذا العنوان. حاول مرة أخرى.',
  'remote.phone.add-library': 'أضف إلى المكتبة',
  'remote.phone.in-library': 'في مكتبتك',
  'remote.phone.close': 'إغلاق',
  'remote.phone.season': 'الموسم {number}',
  'remote.phone.specials': 'حلقات خاصة',
  'remote.phone.episodes': 'الحلقات',
  'remote.phone.rating': 'تقييم IMDb ‏{rating}',
};
