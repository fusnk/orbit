import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'لوحة الأوامر',
  'palette.placeholder': 'ابحث في العناوين والإعدادات والإضافات والإجراءات',
  // Group headings
  'palette.group.recent': 'الأخيرة',
  'palette.group.suggested': 'مقترحات',
  'palette.group.yours': 'محتواك',
  'palette.group.titles': 'العناوين',
  'palette.group.settings': 'الإعدادات',
  'palette.group.addons': 'الإضافات',
  'palette.group.actions': 'الإجراءات',
  // Titles from addons, while typing
  'palette.titles.searching': 'جارٍ البحث في إضافاتك…',
  'palette.titles.none': 'لم يُعثر على عناوين',
  'palette.titles.none-can-search': 'لا توجد إضافة لديك تدعم البحث',
  'palette.titles.failed': 'تعذّر على إضافاتك البحث الآن',
  'palette.search-all': 'كل نتائج «{query}»',
  'palette.no-match': 'لا شيء يطابق «{query}»',
  // Where a title of yours was found
  'palette.from.continue': 'متابعة المشاهدة',
  'palette.from.library': 'في مكتبتك',
  'palette.from.queue': 'في قائمة الانتظار',
  'palette.from.downloads': 'مُنزَّل',
  'palette.from.watched': 'تمت مشاهدته',
  'palette.from.list': 'قائمة',
  // What a result is
  'palette.kind.page': 'صفحة',
  'palette.kind.shortcut': 'اختصار · {key}',
  'palette.kind.addon': 'إضافة',
  'palette.kind.category': 'الإعدادات',
  'palette.kind.setting': 'الإعدادات · {category}',
  'palette.setting-hidden': 'يظهر «{setting}» بعد تغيير «{parent}».',
  'palette.kind.movie': 'فيلم',
  'palette.kind.series': 'مسلسل',
  'palette.kind.title': 'عنوان',
  // Actions
  'palette.action.profile': 'تبديل الملف الشخصي',
  'palette.action.shortcuts': 'اختصارات لوحة المفاتيح',
  'palette.action.install-addon': 'تثبيت إضافة…',
  'palette.action.addon-updates': 'التحقق من تحديثات الإضافات',
  // The key hints along the bottom
  'palette.hint.move': 'تنقّل',
  'palette.hint.open': 'فتح',
  'palette.hint.groups': 'المجموعة التالية',
  'palette.hint.close': 'إغلاق',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'اللغة البدء فتح إغلاق النافذة شريط المهام الحجم التكبير الحركة التأثيرات سهولة الوصول التنبيهات الإشعارات نسخ احتياطي استعادة تشخيص السجلات استيراد trakt letterboxd',
  'palette.keywords.playback': 'تشغيل تلقائي الحلقة التالية استئناف تخطي المقدمة إعلان',
  'palette.keywords.addons': 'تثبيت متجر امتدادات مصادر جودة تورنت تجنّب تفضيل',
  'palette.keywords.downloads': 'دون اتصال التخزين مجلد الجودة',
  'palette.keywords.appearance': 'سمة ألوان لون مميز خط داكن فاتح خلفية الوضع المحيطي شعار أنماط',
  'palette.keywords.shortcuts': 'لوحة المفاتيح اختصارات مفاتيح إعادة تعيين',
  'palette.keywords.home-library': 'أنمي الرئيسية صفوف مُشاهَد متابعة المشاهدة الحرق أقواس القصة المكتبة البيانات الوصفية',
  'palette.keywords.subtitles': 'ترجمة اللغة إجبارية مزامنة ضعاف السمع كلمات الأغاني خط حجم لون',
  'palette.keywords.picture-sound': 'الصورة الفيديو فك الترميز بالعتاد hdr الصوت اللغة passthrough مستوى الصوت',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord خدمات البث مزامنة حساب debrid tmdb تكاملات iptv بث مباشر قنوات m3u xtream دليل',
  // Settings → Shortcuts
  'palette.shortcut': 'لوحة الأوامر',
};
