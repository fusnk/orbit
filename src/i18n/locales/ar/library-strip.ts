import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Arabic strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "لم تبدأ",
  'librarystrip.status.started': "قيد المشاهدة",
  'librarystrip.status.finished': "مكتملة",
  'librarystrip.type.any': "كل الأصناف",
  'librarystrip.status.any': "أي حالة",
};
