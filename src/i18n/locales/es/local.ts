import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Suelta para reproducir',
  'local.drop.video-hint': 'El vídeo se reproduce en Orbit.',
  'local.drop.subtitle-hint': 'Los subtítulos se añaden a lo que se está reproduciendo.',
  'local.drop.first-only': 'Reproduciendo {name}. Orbit reproduce un archivo a la vez, así que el resto se ha omitido.',
  'local.drop.failed': 'No se pudo abrir ese archivo.',
  'local.drop.unsupported': 'Orbit no puede reproducir ese tipo de archivo.',
  'local.drop.subtitle-needs-player': 'Primero inicia un vídeo y luego suelta los subtítulos sobre él.',
  'local.drop.subtitle-added': 'Subtítulos añadidos: {name}',
  'local.drop.subtitle-first-only': 'Subtítulos añadidos: {name}. Solo se usó el primer archivo.',
  'local.drop.subtitle-failed': 'No se pudieron añadir esos subtítulos.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'este equipo',
  'local.source.label': 'Archivo local',
  // Settings → Player → External player
  'local.external.heading': 'Reproductor externo',
  'local.external.player': 'Abrir fuentes en',
  'local.external.player-hint': 'Añade «Abrir en reproductor externo» a las fuentes web del selector de fuentes. Reanudar, saltar intro, las pistas recordadas y el progreso solo funcionan en el reproductor de Orbit.',
  'local.external.none': 'Ninguno',
  'local.external.custom': 'Personalizado',
  'local.external.found': 'Encontrado: {path}',
  'local.external.not-found': 'No se encontró en su carpeta de instalación habitual. Elige Personalizado para indicar dónde está.',
  'local.external.custom-path': 'Programa',
  'local.external.custom-path-hint': 'El archivo del programa del reproductor, elegido en este PC.',
  'local.external.choose': 'Elegir…',
  'local.external.custom-invalid': 'Orbit no puede iniciar eso. Elige el archivo del programa del reproductor.',
  'local.external.always': 'Abrir siempre en el reproductor externo',
  'local.external.always-hint': 'Reproducir envía directamente la mejor fuente web. Los torrents y las descargas se siguen reproduciendo en Orbit.',
  // The source picker
  'local.external.open': 'Externo',
  'local.external.open-label': 'Abrir en reproductor externo',
  'local.external.opened': 'Abierto en el reproductor externo.',
  'local.external.failed': 'El reproductor externo no se inició. Revisa Ajustes → Reproductor.',
};
