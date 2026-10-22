import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Simplified Chinese strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "未开始",
  'librarystrip.status.started': "进行中",
  'librarystrip.status.finished': "已看完",
  'librarystrip.type.any': "所有类型",
  'librarystrip.status.any': "所有状态",
};
