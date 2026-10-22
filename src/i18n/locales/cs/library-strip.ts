import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Czech strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Nezačaté",
  'librarystrip.status.started': "Rozkoukané",
  'librarystrip.status.finished': "Dokončené",
  'librarystrip.type.any': "Všechny typy",
  'librarystrip.status.any': "Jakýkoli stav",
};
