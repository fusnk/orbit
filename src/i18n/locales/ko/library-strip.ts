import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Korean strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "시청 전",
  'librarystrip.status.started': "시청 중",
  'librarystrip.status.finished': "다 봄",
  'librarystrip.type.any': "모든 유형",
  'librarystrip.status.any': "모든 상태",
};
