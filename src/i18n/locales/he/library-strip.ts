import type { libraryStrip as source } from '../en/library-strip';
import type { Catalog } from '../types';

/** Hebrew strings for My Library's filter strip (see the English source). */
export const libraryStrip: Catalog<typeof source> = {
  'librarystrip.status.unstarted': "לא התחלתי",
  'librarystrip.status.started': "בצפייה",
  'librarystrip.status.finished': "סיימתי",
  'librarystrip.type.any': "כל הסוגים",
  'librarystrip.status.any': "כל סטטוס",
};
