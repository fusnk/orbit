import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Japanese strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "おまかせで選ぶ",
  'librarylook.pick.title': "マイライブラリから選ぶ",
  'librarylook.pick.none-type': "マイライブラリにはまだこの種類の作品がありません。",
  'librarylook.pick.none-body': "この条件に合う作品がマイライブラリにありません。条件をゆるめてみてください。",
  'librarylook.stremio.body': "Stremioでも見ていますか？ログインすると、続きを見る作品と視聴済みの作品を引き継げます。",
  'librarylook.stremio.sign-in': "Stremioにログイン",
};
