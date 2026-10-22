import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Russian strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Не начато",
  'librarystrip.status.started': "В процессе",
  'librarystrip.status.finished': "Завершено",
  'librarystrip.type.any': "Все типы",
  'librarystrip.status.any': "Любой статус",
};
