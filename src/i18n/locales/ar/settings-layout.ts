import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Arabic strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'شكل المشغّل، وطريقة عمل أزراره، والمشغّلات الأخرى.',
  'settingslayout.intro.playback': 'الضغط على تشغيل، والحلقة التالية، والتخطي، والإعلانات التشويقية.',
  'settingslayout.intro.appearance': 'المظاهر والألوان والقائمة والخلفيات وصفحات العناوين والملصقات.',
  'settingslayout.keywords.player': 'المشغل التخطيط عناصر التحكم شريط التقدم القفز الصوت تعزيز تصغير ملء الشاشة معاينات الترجيع خارجي vlc mpv',
  'settingslayout.chapter.library': 'المكتبة',
  'settingslayout.chapter.starting': 'بدء فيديو',
  'settingslayout.chapter.skip-tuning': 'ضبط التخطي بدقة',
  'settingslayout.chapter.player-look': 'الشكل',
  'settingslayout.chapter.player-controls': 'عناصر التحكم',
  'settingslayout.chapter.player-window': 'النافذة والميزات الإضافية',
  'settingslayout.chapter.subtitle-text': 'اللغة والنص',
  'settingslayout.chapter.choosing-source': 'اختيار مصدر',
  'settingslayout.chapter.ranking-rules': 'قواعد الترتيب',
  'settingslayout.preview': 'معاينة',
  'settingslayout.none': 'لا شيء',
};
