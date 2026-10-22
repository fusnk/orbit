import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** French strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Pas commencés",
  'librarystrip.status.started': "En cours",
  'librarystrip.status.finished': "Terminés",
  'librarystrip.type.any': "Tous les types",
  'librarystrip.status.any': "Tous les statuts",
};
