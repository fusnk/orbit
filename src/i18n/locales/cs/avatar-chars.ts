import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Postavy z AniList",
  'avatarchars.actor-photo': "Fotka: {actor}",
  'avatarchars.actor-photo-label': "{character}: fotka herce {actor}, který postavu hraje",
  'avatarchars.poster': "Plakát {title}",
  'avatarchars.poster-label': "{character}, zobrazeno plakátem {title}",
};
