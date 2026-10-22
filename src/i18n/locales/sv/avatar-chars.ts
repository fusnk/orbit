import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Figurer från AniList",
  'avatarchars.actor-photo': "Foto av {actor}",
  'avatarchars.actor-photo-label': "{character}: ett foto av {actor}, som spelar rollen",
  'avatarchars.poster': "Affisch för {title}",
  'avatarchars.poster-label': "{character}, visas med affischen för {title}",
};
