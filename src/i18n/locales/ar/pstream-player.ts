import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Arabic strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'أبطأ',
  'pstream.keys.speed-up': 'أسرع',
  'pstream.keys.seek-back-small': 'رجوع ثانية واحدة (عند الإيقاف المؤقت: إطار واحد)',
  'pstream.keys.seek-forward-small': 'تقدّم ثانية واحدة (عند الإيقاف المؤقت: إطار واحد)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'ينتهي في {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'العودة إلى {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'أجزاء يمكن تخطيها',
  'pstream.chapters.to-end': '{from} – النهاية',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'تحديد {episode} كمُشاهَد',
  'pstream.episodes.mark-unwatched': 'تحديد {episode} كغير مُشاهَد',
  'pstream.episodes.watched': 'تمت مشاهدته',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'تطابق جيد',
  'pstream.subs.match-fair': 'تطابق مقبول',
  'pstream.subs.match-poor': 'تطابق ضعيف',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}، بالثواني',
  'pstream.timing.type': '{name}: {value}. فعّله لكتابة قيمة',
  'pstream.timing.invalid': 'اكتب الثواني، مثل 1.5 أو -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'أُعيد ضبط توقيت الترجمة للترجمة الجديدة',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'نمط الترجمة',
  'pstream.style.position': 'الموضع',
  'pstream.style.custom': 'مخصص…',
  'pstream.style.hex': 'رمز اللون، مثل ‎#ffcc00',
  'pstream.style.caps-note': 'ينطبق على الترجمات المضافة من الآن فصاعدًا.',
  'pstream.style.more': 'عتامة النص ولون المربع وعتامته ولون الحدود في الإعدادات ← الترجمة.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'إعادة المحاولة',
  'pstream.error.retry-at': 'إعادة المحاولة من {time}',
  'pstream.error.copy': 'نسخ التفاصيل',
  'pstream.error.copied': 'تم نسخ التفاصيل. حُذفت العناوين والمفاتيح.',
  'pstream.error.copy-failed': 'تعذّر نسخ التفاصيل',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'النقر المزدوج على الجانبين للقفز',
  'pstream.settings.double-click-hint': 'انقر نقرًا مزدوجًا على الثلث الأيسر أو الأيمن من الصورة للرجوع أو التقدم بمقدار قفزة. يظل المنتصف يبدّل وضع ملء الشاشة.',
};
