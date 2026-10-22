import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Arabic text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'فُتح من رابط تثبيت على موقع ويب. تحقّق من الإضافة أدناه قبل تثبيتها.',
  'deeplink.unusable': 'لا يمكن لـ Orbit استخدام هذا الرابط. تُفتح هنا روابط تثبيت الإضافات فقط (التي تنتهي بـ manifest.json).',
  'deeplink.after-video': 'وصل رابط تثبيت إضافة. سيفتحه Orbit عند انتهاء الفيديو.',
  'deeplink.home-network': 'على شبكتك المنزلية',
  'deeplink.home-network-note': 'يشير هذا الرابط إلى هذا الكمبيوتر أو إلى جهاز على شبكتك المنزلية. لم يتصل Orbit به بعد. تابع فقط إذا كنت تتوقع وجود إضافة هناك.',
  'deeplink.continue': 'متابعة',
};
