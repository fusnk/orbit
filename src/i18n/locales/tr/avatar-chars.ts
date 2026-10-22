import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "AniList’ten karakterler",
  'avatarchars.actor-photo': "{actor} fotoğrafı",
  'avatarchars.actor-photo-label': "{character}: rolü oynayan {actor} fotoğrafı",
  'avatarchars.poster': "{title} afişi",
  'avatarchars.poster-label': "{character}, {title} afişiyle gösteriliyor",
};
