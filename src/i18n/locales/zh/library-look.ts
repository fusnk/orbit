import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Simplified Chinese strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "帮我选",
  'librarylook.pick.title': "从我的片库中挑选",
  'librarylook.pick.none-type': "我的片库里还没有这类作品。",
  'librarylook.pick.none-body': "我的片库里没有符合这些条件的作品。试着放宽一些。",
  'librarylook.stremio.body': "也在 Stremio 上看？登录后，继续观看和已看过的作品都会跟过来。",
  'librarylook.stremio.sign-in': "登录 Stremio",
};
