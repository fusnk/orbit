import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'الأنسب',
  'subs.error.sdh': 'تعذّر تطبيق إعداد نص ضعاف السمع',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'إزالة نص ضعاف السمع',
  'subs.settings.strip-sdh-hint': 'يُخفي من الترجمة أوصاف الأصوات مثل [صرير الباب] وإشارات الموسيقى وأسماء المتحدثين مثل JOHN:. تُتخطّى الأسطر التي تصبح فارغة، ويبقى التوقيت كما هو.',
  'subs.settings.keep-lyrics': 'الإبقاء على كلمات الأغاني',
  'subs.settings.keep-lyrics-hint': 'تبقى الأسطر المغنّاة المعلَّمة بـ ♪ عند إزالة نص ضعاف السمع. أما الأسطر التي لا تحوي سوى نوتات موسيقية فتُزال.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'تعذّر إبقاء الترجمة في الأسفل',
  'subs.player.position': 'موضع الترجمة',
  'subs.player.height': 'الارتفاع',
  'subs.player.raised': 'أعلى بنسبة {value}%',
  'subs.player.reset': 'إعادة إلى الأسفل',
  'subs.player.keep-bottom': 'الإبقاء في الأسفل',
  'subs.player.keep-bottom-hint': 'تتجاهل الترجمات البسيطة (مثل SRT) الموضع الوارد في الملف، فيظهر كل سطر على هذا الارتفاع. وتفقد الترجمات البسيطة المضمَّنة في الفيديو خطها المائل أيضًا. أما الترجمات المنسّقة (ASS، الشائعة في الأنمي) فتحتفظ بتخطيطها. يُحفظ لكل الفيديوهات.',
};
