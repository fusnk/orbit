import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "Postacie z AniList",
  'avatarchars.actor-photo': "Zdjęcie: {actor}",
  'avatarchars.actor-photo-label': "{character}: zdjęcie aktora {actor}, który gra tę postać",
  'avatarchars.poster': "Plakat: {title}",
  'avatarchars.poster-label': "{character}, przedstawiona plakatem: {title}",
};
