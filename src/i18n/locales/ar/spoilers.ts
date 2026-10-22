import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'الحرق',
  'spoilers.intro': 'ما يُخفى عن الحلقات: في صفحة المسلسل، وفي قائمة الحلقات في المشغّل، وفي بطاقة «التالي»، وفي «متابعة المشاهدة».',
  'spoilers.titles': 'إخفاء عناوين الحلقات',
  'spoilers.titles-hint': 'يعرض «الحلقة 4» بدلًا من اسم الحلقة.',
  'spoilers.descriptions': 'إخفاء أوصاف الحلقات',
  'spoilers.descriptions-hint': 'يحذف ملخّص كل حلقة.',
  'spoilers.thumbnails': 'تمويه صور الحلقات',
  'spoilers.thumbnails-hint': 'مرّر المؤشر فوق حلقة أو حدّدها لإلقاء نظرة.',
  'spoilers.ratings': 'إخفاء تقييمات الحلقات',
  'spoilers.ratings-hint': 'قد يكشف التقييم أي الحلقات مهمة.',
  'spoilers.unaired': 'إخفاء مواعيد عرض الحلقات القادمة',
  'spoilers.unaired-hint': 'الحلقات التي لم تصدر بعد تقول فقط «لم تُعرض بعد».',
  'spoilers.scope': 'ينطبق على',
  'spoilers.scope-hint': 'الحلقات التي أنهيتها أو بدأتها تعرض كل شيء، ما لم تختر كل الحلقات.',
  'spoilers.scope-unwatched': 'الحلقات التي لم أشاهدها',
  'spoilers.scope-all': 'كل الحلقات',
};
