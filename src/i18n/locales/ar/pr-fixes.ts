import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Arabic strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "هل تريد تحديث إعدادات هذه الإضافة؟",
  'prfixes.addons.update-detail': "{name} مثبتة بالفعل. تحل هذه الإعدادات محل إعداداتها القديمة، وتبقى في مكانها في قائمتك.",
  'prfixes.addons.update': "تحديث",
  'prfixes.audio.original': "اللغة الأصلية أولًا",
  'prfixes.audio.original-hint': "يبدأ كل فيلم أو مسلسل باللغة التي صُنع بها، عندما يتضمن الفيديو هذا الصوت: الأنمي باليابانية والدراما الكورية بالكورية. وإلا فلغة الصوت أعلاه. يتطلب مفتاح TMDB.",
  'prfixes.bundle.local': "يشير هذا العنوان إلى هذا الكمبيوتر أو إلى شبكتك المنزلية، لذا لم يتصل به Orbit.",
};
