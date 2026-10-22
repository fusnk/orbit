import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "AniList のキャラクター",
  'avatarchars.actor-photo': "{actor} の写真",
  'avatarchars.actor-photo-label': "{character}：演じる {actor} の写真",
  'avatarchars.poster': "{title} のポスター",
  'avatarchars.poster-label': "{character}（{title} のポスター）",
};
