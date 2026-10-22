import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "דמויות מ-AniList",
  'avatarchars.actor-photo': "תמונה של {actor}",
  'avatarchars.actor-photo-label': "{character}: תמונה של {actor}, שמגלם את התפקיד",
  'avatarchars.poster': "הפוסטר של {title}",
  'avatarchars.poster-label': "{character}, מוצג באמצעות הפוסטר של {title}",
};
