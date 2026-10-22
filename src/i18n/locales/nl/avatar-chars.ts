import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Personages van AniList",
  'avatarchars.actor-photo': "Foto van {actor}",
  'avatarchars.actor-photo-label': "{character}: een foto van {actor}, die de rol speelt",
  'avatarchars.poster': "Poster van {title}",
  'avatarchars.poster-label': "{character}, weergegeven met de poster van {title}",
};
