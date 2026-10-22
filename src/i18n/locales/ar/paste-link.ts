import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Arabic strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "تشغيل هذا الرابط",
  'pastelink.play-magnet': "تشغيل رابط المغناطيس هذا",
  'pastelink.magnet': "رابط مغناطيس",
  'pastelink.source': "رابط ملصق",
  'pastelink.detail': "يُفتح في المشغّل. لا يُحفظ شيء في سجل المشاهدة.",
  'pastelink.torrents-off.title': "روابط المغناطيس تحتاج إلى تشغيل التورنت",
  'pastelink.torrents-off.detail': "يشغّل Orbit روابط المغناطيس بمشغّل التورنت الخاص به، وهو متوقف حاليًا. يمكنك تشغيل التورنت من الإعدادات.",
  'pastelink.torrents-off.open': "فتح الإعدادات",
};
