import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Персонажи из AniList",
  'avatarchars.actor-photo': "Фото: {actor}",
  'avatarchars.actor-photo-label': "{character}: фото актёра {actor}, который играет эту роль",
  'avatarchars.poster': "Постер «{title}»",
  'avatarchars.poster-label': "{character}, показан постером «{title}»",
};
