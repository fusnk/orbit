import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Personaggi da AniList",
  'avatarchars.actor-photo': "Foto di {actor}",
  'avatarchars.actor-photo-label': "{character}: una foto di {actor}, che interpreta il ruolo",
  'avatarchars.poster': "Locandina di {title}",
  'avatarchars.poster-label': "{character}, rappresentato dalla locandina di {title}",
};
