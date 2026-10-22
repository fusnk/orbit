import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "الشخصيات من AniList",
  'avatarchars.actor-photo': "صورة {actor}",
  'avatarchars.actor-photo-label': "{character}: صورة {actor} الذي يؤدي الدور",
  'avatarchars.poster': "ملصق {title}",
  'avatarchars.poster-label': "{character}، ممثَّلة بملصق {title}",
};
