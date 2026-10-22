import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'أفلِت للتشغيل',
  'local.drop.video-hint': 'يُشغَّل الفيديو في Orbit.',
  'local.drop.subtitle-hint': 'تُضاف الترجمة إلى ما يُشغَّل الآن.',
  'local.drop.first-only': 'جارٍ تشغيل {name}. يشغّل Orbit ملفًا واحدًا في كل مرة، لذا تُركت الملفات الأخرى.',
  'local.drop.failed': 'تعذّر فتح هذا الملف.',
  'local.drop.unsupported': 'لا يستطيع Orbit تشغيل هذا النوع من الملفات.',
  'local.drop.subtitle-needs-player': 'شغّل فيديو أولًا، ثم أفلِت ملف الترجمة عليه.',
  'local.drop.subtitle-added': 'أُضيفت الترجمة: {name}',
  'local.drop.subtitle-first-only': 'أُضيفت الترجمة: {name}. استُخدم الملف الأول فقط.',
  'local.drop.subtitle-failed': 'تعذّرت إضافة هذه الترجمة.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'هذا الكمبيوتر',
  'local.source.label': 'ملف محلي',
  // Settings → Player → External player
  'local.external.heading': 'مشغّل خارجي',
  'local.external.player': 'فتح المصادر في',
  'local.external.player-hint': 'يضيف «فتح في مشغّل خارجي» إلى مصادر الويب في منتقي المصادر. الاستئناف وتخطي المقدمة والمسارات المحفوظة وتقدّم المشاهدة تعمل فقط في مشغّل Orbit.',
  'local.external.none': 'لا شيء',
  'local.external.custom': 'مخصّص',
  'local.external.found': 'تم العثور عليه: {path}',
  'local.external.not-found': 'لم يُعثر عليه في مجلد التثبيت المعتاد. اختر «مخصّص» لتحديد مكانه.',
  'local.external.custom-path': 'البرنامج',
  'local.external.custom-path-hint': 'ملف برنامج المشغّل، المختار على هذا الكمبيوتر.',
  'local.external.choose': 'اختيار…',
  'local.external.custom-invalid': 'لا يستطيع Orbit تشغيل ذلك. اختر ملف برنامج المشغّل.',
  'local.external.always': 'الفتح دائمًا في المشغّل الخارجي',
  'local.external.always-hint': 'يرسل «تشغيل» أفضل مصدر ويب إليه مباشرة. تبقى التورنتات والتنزيلات في Orbit.',
  // The source picker
  'local.external.open': 'خارجي',
  'local.external.open-label': 'فتح في مشغّل خارجي',
  'local.external.opened': 'فُتح في المشغّل الخارجي.',
  'local.external.failed': 'لم يبدأ المشغّل الخارجي. راجع الإعدادات ← المشغّل.',
};
