import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Personagens do AniList",
  'avatarchars.actor-photo': "Foto de {actor}",
  'avatarchars.actor-photo-label': "{character}: uma foto de {actor}, que interpreta o papel",
  'avatarchars.poster': "Pôster de {title}",
  'avatarchars.poster-label': "{character}, representado pelo pôster de {title}",
};
