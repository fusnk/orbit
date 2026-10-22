import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Spanish strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Explorar',
  'remote.phone.browse-loading': 'Cargando tu Inicio…',
  'remote.phone.browse-empty': 'Aún no hay nada. Añade un complemento de catálogo en Orbit para llenar el Inicio.',
  'remote.phone.browse-failed': 'No se pudo cargar tu Inicio. Vuelve a intentarlo.',
  'remote.phone.refresh': 'Actualizar',
  'remote.phone.moods': '¿Qué te apetece ver?',
  'remote.phone.mood-loading': 'Buscando sugerencias…',
  'remote.phone.mood-empty': 'Ahora no hay sugerencias para este ánimo.',
  'remote.phone.surprise': 'Sorpréndeme',
  'remote.phone.surprise-hint': 'Una sugerencia al azar de tus catálogos.',
  'remote.phone.surprise-movie': 'Una película',
  'remote.phone.surprise-series': 'Una serie',
  'remote.phone.surprise-none': 'Ahora no hay nada nuevo que sugerir. Prueba el otro tipo o cambia las opciones de Sorpréndeme en Orbit.',
  'remote.phone.details-loading': 'Cargando detalles…',
  'remote.phone.details-failed': 'No se pudo cargar este título. Vuelve a intentarlo.',
  'remote.phone.add-library': 'Añadir a la biblioteca',
  'remote.phone.in-library': 'En tu biblioteca',
  'remote.phone.close': 'Cerrar',
  'remote.phone.season': 'Temporada {number}',
  'remote.phone.specials': 'Especiales',
  'remote.phone.episodes': 'Episodios',
  'remote.phone.rating': 'Valoración de IMDb {rating}',
};
