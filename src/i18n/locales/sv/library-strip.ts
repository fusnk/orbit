import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Swedish strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Inte påbörjade",
  'librarystrip.status.started': "Pågående",
  'librarystrip.status.finished': "Avslutade",
  'librarystrip.type.any': "Alla typer",
  'librarystrip.status.any': "Alla statusar",
};
