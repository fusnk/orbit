import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** German strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Nicht angefangen",
  'librarystrip.status.started': "Angefangen",
  'librarystrip.status.finished': "Abgeschlossen",
  'librarystrip.type.any': "Alle Typen",
  'librarystrip.status.any': "Jeder Status",
};
