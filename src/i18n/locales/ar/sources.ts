import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'حدود التشغيل التلقائي',
  'sources.limits.any': 'أي',
  'sources.limits.min-quality': 'لا يبدأ التشغيل التلقائي بجودة أقل من',
  'sources.limits.min-quality-hint': 'لا يبدأ «تشغيل» والحلقة التالية إلا مصادر بهذه الجودة على الأقل (ولا تُحتسب المصادر التي لا تذكر جودتها). إن لم يناسب أي مصدر، يُشغَّل الأفضل ويخبرك Orbit بذلك. تبقى قائمة المصادر تعرض كل شيء. لهذا الملف الشخصي.',
  'sources.limits.max-quality': 'لا يبدأ التشغيل التلقائي بجودة أعلى من',
  'sources.limits.max-quality-hint': 'لا يبدأ «تشغيل» والحلقة التالية مصادر أعلى من هذه الجودة، إلا إذا لم يوجد غيرها. وعلى خلاف «أعلى جودة مفضّلة»، لا يغيّر ترتيب قائمة المصادر. لهذا الملف الشخصي.',
  'sources.limits.max-size': 'لا يشغّل التشغيل التلقائي ملفات أكبر من',
  'sources.limits.max-size-hint': 'للاتصالات البطيئة أو باقات البيانات المحدودة: يتخطى «تشغيل» والحلقة التالية الملفات الأكبر. لا يتأثر بذلك المصادر التي لا تذكر حجمها. لهذا الملف الشخصي.',
  'sources.autoplay.outside-limits': 'لا شيء ضمن حدود التشغيل التلقائي، لذا يُشغَّل أفضل مصدر.',
  'sources.autoplay.only-uncached': 'كل المصادر التي وُجدت ما زالت تُنزَّل إلى خدمة debrid لديك. اختر واحدًا لبدئه.',
  'sources.note.uncached': 'غير مخزّن',
  'sources.note.uncached-hint': 'ما زال يُنزَّل إلى خدمة debrid لديك: لا يبدأ تلقائيًا أبدًا',
  'sources.note.outside-limits': 'خارج حدود التشغيل التلقائي',
  'sources.note.outside-limits-hint': 'يتخطاه «تشغيل» والحلقة التالية (الإعدادات ← الإضافات والمصادر ← تفضيلات المصادر ← حدود التشغيل التلقائي)',
  'sources.next-up.unaired': 'التالي · موعد العرض غير مؤكد',
};
