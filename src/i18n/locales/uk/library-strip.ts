import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Ukrainian strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "Не розпочато",
  'librarystrip.status.started': "У процесі",
  'librarystrip.status.finished': "Завершено",
  'librarystrip.type.any': "Усі типи",
  'librarystrip.status.any': "Будь-який статус",
};
