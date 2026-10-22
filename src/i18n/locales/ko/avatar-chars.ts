import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "AniList 캐릭터",
  'avatarchars.actor-photo': "{actor} 사진",
  'avatarchars.actor-photo-label': "{character}: 역을 맡은 {actor}의 사진",
  'avatarchars.poster': "{title} 포스터",
  'avatarchars.poster-label': "{character}, {title} 포스터로 표시",
};
