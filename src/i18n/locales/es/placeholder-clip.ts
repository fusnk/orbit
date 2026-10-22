import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Spanish strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Esta fuente envió un clip de relleno corto, no el vídeo: el servicio debrid aún no lo ha descargado. Prueba otra fuente o vuelve a intentarlo más tarde.",
};
