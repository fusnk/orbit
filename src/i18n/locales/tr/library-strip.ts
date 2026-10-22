import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Turkish strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Başlanmadı",
  'librarystrip.status.started': "Devam ediyor",
  'librarystrip.status.finished': "Bitti",
  'librarystrip.type.any': "Tüm tipler",
  'librarystrip.status.any': "Tüm durumlar",
};
