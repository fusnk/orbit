import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'معاينة',
  'subfonts.preview-hint': 'عيّنة من ترجماتك كما يرسمها المشغّل. الأحجام والحدود قريبة مما يعرضه المشغّل وليست مطابقة تمامًا.',
  'subfonts.fullscreen': 'معاينة بملء الشاشة',
  'subfonts.fullscreen-close': 'اضغط Esc أو انقر للإغلاق',
  'subfonts.line1': 'لم أتوقع يومًا أن نصل إلى هنا.',
  'subfonts.line2': 'ولا أنا. لنواصل الطريق.',
  'subfonts.font': 'الخط',
  'subfonts.font-label': 'خط الترجمة',
  'subfonts.font-hint': 'خطوط Atkinson Hyperlegible وLexend وOpenDyslexic مصمّمة لقراءة أسهل، وهي مضمّنة مع Orbit. الترجمات المنسّقة تحتفظ بخطها الخاص.',
  'subfonts.default': 'الافتراضي',
};
