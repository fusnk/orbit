import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Spanish strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Sin empezar",
  'librarystrip.status.started': "En curso",
  'librarystrip.status.finished': "Terminados",
  'librarystrip.type.any': "Todos los tipos",
  'librarystrip.status.any': "Cualquier estado",
};
