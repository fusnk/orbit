import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Polish strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Nierozpoczęte",
  'librarystrip.status.started': "W trakcie",
  'librarystrip.status.finished': "Ukończone",
  'librarystrip.type.any': "Wszystkie typy",
  'librarystrip.status.any': "Dowolny status",
};
