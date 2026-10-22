import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Arabic strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "جهاز الإخراج",
  'audiodevice.hint': "مكان تشغيل الصوت. يتبع الافتراضي للنظام اختيار جهاز الكمبيوتر، حتى لو تغيّر أثناء الفيديو. إذا فُصل الجهاز المختار هنا، ينتقل الصوت إلى الافتراضي للنظام حتى يعود.",
  'audiodevice.default': "الافتراضي للنظام",
  'audiodevice.missing': "غير متصل: يُشغَّل على الافتراضي للنظام",
  'audiodevice.error': "تعذّر تغيير جهاز الإخراج",
};
