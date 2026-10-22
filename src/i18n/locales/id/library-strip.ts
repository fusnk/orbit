import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Indonesian strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Belum dimulai",
  'librarystrip.status.started': "Sedang ditonton",
  'librarystrip.status.finished': "Selesai",
  'librarystrip.type.any': "Semua jenis",
  'librarystrip.status.any': "Semua status",
};
