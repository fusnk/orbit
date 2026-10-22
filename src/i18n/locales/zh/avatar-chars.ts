import type { avatarChars as source } from '../en/avatar-chars';

export const avatarChars: Record<keyof typeof source, string> = {
  'avatarchars.from-anilist': "来自 AniList 的角色",
  'avatarchars.actor-photo': "{actor} 的照片",
  'avatarchars.actor-photo-label': "{character}：饰演者 {actor} 的照片",
  'avatarchars.poster': "《{title}》海报",
  'avatarchars.poster-label': "{character}，以《{title}》海报显示",
};
