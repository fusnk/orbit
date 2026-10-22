import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Polish strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "Wybierz za mnie",
  'librarylook.pick.title': "Wybór z mojej biblioteki",
  'librarylook.pick.none-type': "W twojej bibliotece nie ma jeszcze nic tego typu.",
  'librarylook.pick.none-body': "Nic w twojej bibliotece nie pasuje do tych wyborów. Spróbuj je poluzować.",
  'librarylook.stremio.body': "Oglądasz też w Stremio? Zaloguj się, a Oglądaj dalej i obejrzane tytuły przejdą z tobą.",
  'librarylook.stremio.sign-in': "Zaloguj się do Stremio",
};
