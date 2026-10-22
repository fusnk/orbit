import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Spanish strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Cómo se ve el reproductor, cómo responden sus controles y otros reproductores.',
  'settingslayout.intro.playback': 'Pulsar Reproducir, el siguiente episodio, los saltos y los tráileres.',
  'settingslayout.intro.appearance': 'Estilos, colores, el menú, fondos, páginas de títulos y pósteres.',
  'settingslayout.keywords.player': 'reproductor diseño controles barra de progreso saltar volumen aumentar minimizar pantalla completa vistas previas rebobinar externo vlc mpv',
  'settingslayout.chapter.library': 'Biblioteca',
  'settingslayout.chapter.starting': 'Empezar un vídeo',
  'settingslayout.chapter.skip-tuning': 'Ajustar los saltos',
  'settingslayout.chapter.player-look': 'Aspecto',
  'settingslayout.chapter.player-controls': 'Controles',
  'settingslayout.chapter.player-window': 'Ventana y extras',
  'settingslayout.chapter.subtitle-text': 'Idioma y texto',
  'settingslayout.chapter.choosing-source': 'Elegir una fuente',
  'settingslayout.chapter.ranking-rules': 'Reglas de orden',
  'settingslayout.preview': 'Vista previa',
  'settingslayout.none': 'Ninguna',
};
