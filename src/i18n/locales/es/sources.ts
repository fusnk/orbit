import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Límites de reproducción automática',
  'sources.limits.any': 'Cualquiera',
  'sources.limits.min-quality': 'La reproducción automática no empieza por debajo de',
  'sources.limits.min-quality-hint': 'Reproducir y el siguiente episodio solo inician fuentes al menos así de buenas (las que no lo indican no cuentan). Si ninguna encaja, se reproduce la mejor y Orbit te lo dice. La lista de fuentes sigue mostrándolo todo. Para este perfil.',
  'sources.limits.max-quality': 'La reproducción automática no empieza por encima de',
  'sources.limits.max-quality-hint': 'Reproducir y el siguiente episodio no inician fuentes por encima de esta, salvo que no haya otra. A diferencia de «Calidad máxima preferida», no reordena la lista de fuentes. Para este perfil.',
  'sources.limits.max-size': 'La reproducción automática no inicia archivos de más de',
  'sources.limits.max-size-hint': 'Para conexiones lentas o datos limitados: Reproducir y el siguiente episodio omiten archivos más grandes. Las fuentes que no indican su tamaño no se ven afectadas. Para este perfil.',
  'sources.autoplay.outside-limits': 'Nada encaja en tus límites de reproducción automática, así que se reproduce la mejor fuente.',
  'sources.autoplay.only-uncached': 'Todas las fuentes encontradas se siguen descargando en tu servicio debrid. Elige una para iniciarla.',
  'sources.note.uncached': 'Sin caché',
  'sources.note.uncached-hint': 'Aún se descarga en tu servicio debrid: nunca se inicia automáticamente',
  'sources.note.outside-limits': 'Fuera de los límites',
  'sources.note.outside-limits-hint': 'Reproducir y el siguiente episodio la omiten (Ajustes → Complementos y fuentes → Preferencias de fuentes → Límites de reproducción automática)',
  'sources.next-up.unaired': 'A continuación · fecha de emisión sin confirmar',
};
