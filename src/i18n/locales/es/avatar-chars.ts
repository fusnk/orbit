import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Personajes de AniList",
  'avatarchars.actor-photo': "Foto de {actor}",
  'avatarchars.actor-photo-label': "{character}: una foto de {actor}, que interpreta el papel",
  'avatarchars.poster': "Póster de {title}",
  'avatarchars.poster-label': "{character}, con el póster de {title}",
};
