import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Japanese strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "未視聴",
  'librarystrip.status.started': "視聴中",
  'librarystrip.status.finished': "視聴済み",
  'librarystrip.type.any': "すべての種類",
  'librarystrip.status.any': "すべてのステータス",
};
