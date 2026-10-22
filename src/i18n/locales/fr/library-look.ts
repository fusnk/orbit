import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** French strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "Choisir pour moi",
  'librarylook.pick.title': "Choisir dans Ma bibliothèque",
  'librarylook.pick.none-type': "Rien de ce type dans Ma bibliothèque pour l’instant.",
  'librarylook.pick.none-body': "Rien dans Ma bibliothèque ne correspond à ces choix. Essayez de les assouplir.",
  'librarylook.stremio.body': "Vous regardez aussi sur Stremio ? Connectez-vous et vos titres à reprendre et déjà vus vous suivent.",
  'librarylook.stremio.sign-in': "Se connecter à Stremio",
};
