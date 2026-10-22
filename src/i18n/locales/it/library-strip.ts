import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Italian strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Non iniziati",
  'librarystrip.status.started': "In corso",
  'librarystrip.status.finished': "Finiti",
  'librarystrip.type.any': "Tutti i tipi",
  'librarystrip.status.any': "Qualsiasi stato",
};
