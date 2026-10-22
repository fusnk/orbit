import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Mejor coincidencia',
  'subs.error.sdh': 'No se ha podido aplicar tu ajuste de texto para personas sordas',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Quitar el texto para personas sordas',
  'subs.settings.strip-sdh-hint': 'Oculta de los subtítulos las descripciones de sonidos como [cruje la puerta], las indicaciones de música y los nombres de quien habla como JUAN:. Las líneas que quedan vacías se omiten; los tiempos no cambian.',
  'subs.settings.keep-lyrics': 'Mantener las letras de canciones',
  'subs.settings.keep-lyrics-hint': 'Las líneas cantadas marcadas con ♪ se mantienen al quitar el texto para personas sordas. Las líneas con solo notas musicales se quitan igualmente.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'No se han podido mantener los subtítulos abajo',
  'subs.player.position': 'Posición de los subtítulos',
  'subs.player.height': 'Altura',
  'subs.player.raised': '{value} % más arriba',
  'subs.player.reset': 'Volver abajo',
  'subs.player.keep-bottom': 'Mantener abajo',
  'subs.player.keep-bottom-hint': 'Los subtítulos simples (como SRT) ignoran la posición del archivo, así que cada línea queda a esta altura. Los subtítulos simples incluidos en el vídeo pierden también la cursiva. Los subtítulos con estilo (ASS, habituales en el anime) conservan su diseño. Se recuerda para todos los vídeos.',
};
