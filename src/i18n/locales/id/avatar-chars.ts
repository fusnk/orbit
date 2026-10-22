import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Karakter dari AniList",
  'avatarchars.actor-photo': "Foto {actor}",
  'avatarchars.actor-photo-label': "{character}: foto {actor}, pemeran tokoh ini",
  'avatarchars.poster': "Poster {title}",
  'avatarchars.poster-label': "{character}, ditampilkan dengan poster {title}",
};
