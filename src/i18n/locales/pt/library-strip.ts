import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Portuguese strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Não iniciados",
  'librarystrip.status.started': "Em andamento",
  'librarystrip.status.finished': "Concluídos",
  'librarystrip.type.any': "Todos os tipos",
  'librarystrip.status.any': "Qualquer status",
};
