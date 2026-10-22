import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Dutch strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Niet begonnen",
  'librarystrip.status.started': "Bezig",
  'librarystrip.status.finished': "Afgerond",
  'librarystrip.type.any': "Alle soorten",
  'librarystrip.status.any': "Elke status",
};
