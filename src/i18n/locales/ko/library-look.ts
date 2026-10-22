import type { libraryLook as source } from '../en/library-look';
import type { Catalog } from '../types';

/** Korean strings for My Library's redesign (see the English source). */
export const libraryLook: Catalog<typeof source> = {
  'librarylook.pick.open': "골라 줘",
  'librarylook.pick.title': "내 라이브러리에서 고르기",
  'librarylook.pick.none-type': "내 라이브러리에 아직 이 유형의 작품이 없어요.",
  'librarylook.pick.none-body': "이 조건에 맞는 작품이 내 라이브러리에 없어요. 조건을 조금 넓혀 보세요.",
  'librarylook.stremio.body': "Stremio에서도 보시나요? 로그인하면 이어서 보기와 시청한 작품을 가져올 수 있어요.",
  'librarylook.stremio.sign-in': "Stremio에 로그인",
};
