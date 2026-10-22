import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Russian strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "Выбери за меня",
  'librarylook.pick.title': "Выбор из моей библиотеки",
  'librarylook.pick.none-type': "В вашей библиотеке пока нет ничего такого типа.",
  'librarylook.pick.none-body': "В вашей библиотеке ничего не подходит под эти условия. Попробуйте их ослабить.",
  'librarylook.stremio.body': "Смотрите и в Stremio? Войдите, и «Продолжить просмотр» и просмотренное перенесутся сюда.",
  'librarylook.stremio.sign-in': "Войти в Stremio",
};
