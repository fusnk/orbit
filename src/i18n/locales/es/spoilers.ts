import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoilers',
  'spoilers.intro': 'Qué ocultar de los episodios: en la página de una serie, en la lista de episodios del reproductor, en la tarjeta A continuación y en Seguir viendo.',
  'spoilers.titles': 'Ocultar los títulos de los episodios',
  'spoilers.titles-hint': 'Muestra «Episodio 4» en lugar del nombre del episodio.',
  'spoilers.descriptions': 'Ocultar las descripciones de los episodios',
  'spoilers.descriptions-hint': 'Omite el resumen de cada episodio.',
  'spoilers.thumbnails': 'Difuminar las imágenes de los episodios',
  'spoilers.thumbnails-hint': 'Pasa el ratón o enfoca un episodio para echar un vistazo.',
  'spoilers.ratings': 'Ocultar las valoraciones de los episodios',
  'spoilers.ratings-hint': 'Una valoración puede delatar qué episodios importan.',
  'spoilers.unaired': 'Ocultar las fechas de emisión de los próximos episodios',
  'spoilers.unaired-hint': 'Los episodios aún no emitidos solo indican «Aún no emitido».',
  'spoilers.scope': 'Se aplica a',
  'spoilers.scope-hint': 'Los episodios que has terminado o empezado lo muestran todo, salvo que elijas todos los episodios.',
  'spoilers.scope-unwatched': 'Episodios que no he visto',
  'spoilers.scope-all': 'Todos los episodios',
};
