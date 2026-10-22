import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Personnages issus d’AniList",
  'avatarchars.actor-photo': "Photo de {actor}",
  'avatarchars.actor-photo-label': "{character} : une photo de {actor}, qui joue le rôle",
  'avatarchars.poster': "Affiche de {title}",
  'avatarchars.poster-label': "{character}, représenté par l’affiche de {title}",
};
