import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Paleta de comandos',
  'palette.placeholder': 'Busca títulos, ajustes, complementos y acciones',
  // Group headings
  'palette.group.recent': 'Recientes',
  'palette.group.suggested': 'Sugerencias',
  'palette.group.yours': 'Lo tuyo',
  'palette.group.titles': 'Títulos',
  'palette.group.settings': 'Ajustes',
  'palette.group.addons': 'Complementos',
  'palette.group.actions': 'Acciones',
  // Titles from addons, while typing
  'palette.titles.searching': 'Buscando en tus complementos…',
  'palette.titles.none': 'No se encontraron títulos',
  'palette.titles.none-can-search': 'Ninguno de tus complementos puede buscar',
  'palette.titles.failed': 'Tus complementos no pudieron buscar ahora',
  'palette.search-all': 'Ver todos los resultados de “{query}”',
  'palette.no-match': 'Nada coincide con “{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Seguir viendo',
  'palette.from.library': 'En tu biblioteca',
  'palette.from.queue': 'En tu cola',
  'palette.from.downloads': 'Descargado',
  'palette.from.watched': 'Visto',
  'palette.from.list': 'Lista',
  // What a result is
  'palette.kind.page': 'Página',
  'palette.kind.shortcut': 'Atajo · {key}',
  'palette.kind.addon': 'Complemento',
  'palette.kind.category': 'Ajustes',
  'palette.kind.setting': 'Ajustes · {category}',
  'palette.setting-hidden': '«{setting}» aparece cuando cambias «{parent}».',
  'palette.kind.movie': 'Película',
  'palette.kind.series': 'Serie',
  'palette.kind.title': 'Título',
  // Actions
  'palette.action.profile': 'Cambiar de perfil',
  'palette.action.shortcuts': 'Atajos de teclado',
  'palette.action.install-addon': 'Instalar un complemento…',
  'palette.action.addon-updates': 'Buscar actualizaciones de complementos',
  // The key hints along the bottom
  'palette.hint.move': 'Mover',
  'palette.hint.open': 'Abrir',
  'palette.hint.groups': 'Siguiente grupo',
  'palette.hint.close': 'Cerrar',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'idioma inicio abrir cerrar ventana bandeja escala zoom movimiento efectos accesibilidad avisos notificaciones copia restaurar diagnóstico registros importar trakt letterboxd',
  'palette.keywords.playback': 'reproducción automática siguiente episodio reanudar saltar intro tráiler',
  'palette.keywords.addons': 'instalar tienda extensiones plugins fuentes calidad torrents evitar preferir',
  'palette.keywords.downloads': 'sin conexión almacenamiento carpeta calidad',
  'palette.keywords.appearance': 'tema colores acento fuente oscuro claro fondo ambiente logotipo estilos',
  'palette.keywords.shortcuts': 'teclado atajos teclas reasignar',
  'palette.keywords.home-library': 'anime inicio filas visto seguir viendo spoilers arcos argumentales biblioteca metadatos',
  'palette.keywords.subtitles': 'subtítulos idioma forzados sincronizar sordos letras fuente tamaño color',
  'palette.keywords.picture-sound': 'imagen vídeo decodificación por hardware hdr audio sonido idioma passthrough volumen',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord servicios de streaming sincronizar cuenta debrid tmdb integraciones iptv tv en directo canales m3u xtream guía',
  // Settings → Shortcuts
  'palette.shortcut': 'Paleta de comandos',
};
