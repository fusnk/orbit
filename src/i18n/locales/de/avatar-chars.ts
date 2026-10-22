import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Figuren von AniList",
  'avatarchars.actor-photo': "Foto von {actor}",
  'avatarchars.actor-photo-label': "{character}: ein Foto von {actor}, der die Rolle spielt",
  'avatarchars.poster': "Poster von {title}",
  'avatarchars.poster-label': "{character}, dargestellt mit dem Poster von {title}",
};
