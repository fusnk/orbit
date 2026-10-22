import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** Spanish strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Desde',
  'explore.filters.year-to': 'Hasta',
  'explore.filters.runtime': 'Duración',
  'explore.filters.runtime-min': 'Al menos',
  'explore.filters.runtime-max': 'Como máximo',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Reparto',
  'explore.filters.director': 'Dirección o equipo',
  'explore.filters.person-search': 'Buscar personas: {what}',
  'explore.filters.person-placeholder': 'Escribe un nombre',
  'explore.filters.person-none': 'No se encontró a nadie',
  'explore.filters.person-clear': 'Quitar a {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Caché para retroceder',
  'settings.player.rewind-hint': 'Cuánto vídeo se queda en memoria para que retroceder sea instantáneo. Más usa hasta unos 600 MB de RAM durante la reproducción; Máximo, hasta unos 1,5 GB. Se aplica a partir del próximo vídeo.',
  'settings.player.rewind-standard': 'Estándar',
  'settings.player.rewind-more': 'Más',
  'settings.player.rewind-most': 'Máximo',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Opacidad del texto',
  'subs.style.box-colour': 'Color del recuadro',
  'subs.style.box-opacity': 'Opacidad del recuadro',
  'subs.style.box-opacity-hint': 'El recuadro tiene esquinas rectas: el reproductor no puede dibujarlas redondeadas.',
  'subs.style.outline-colour': 'Color del contorno',
  'player.subtitle-style.black': 'Negro',
  'player.subtitle-style.grey': 'Gris',
  'player.subtitle-style.navy': 'Azul marino',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'No respondió',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} instalado',
  'addons.health.installed.other': '{count} instalados',
  'addons.health.enabled.one': '{count} activado',
  'addons.health.enabled.other': '{count} activados',
  'addons.health.refresh': 'Actualizar complemento',
  'addons.health.refreshing': 'Actualizando {name}…',
  'addons.health.refreshed': '{name} se actualizó.',
  'addons.health.unchanged': '{name} respondió: no hay cambios.',
  'addons.health.refresh-failed': '{name} no respondió. Orbit sigue usando lo que tenía.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Tamaño mínimo',
  'sources.rules.min-size-hint': 'Para películas; los episodios, un tercio. Los archivos más pequeños, a menudo falsos o grabados en el cine, van después de todos los demás, pero nunca se ocultan. No afecta a las fuentes que no indican su tamaño.',
  'titles.why.under-size': 'Por debajo de tu mínimo de {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Buscar una colección',
  'collections.search.placeholder': 'Buscar una colección',
  'collections.search.none': 'Ninguna colección coincide',
  'collections.search.none-detail': 'Se buscan nombres y grupos.',
  'collections.search.titles-label': 'Buscar un título en esta colección',
  'collections.search.titles-placeholder': 'Buscar un título',
  'collections.search.no-titles': 'Ningún título coincide',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Exportar al calendario (.ics)',
  'radar.export.hint': 'Guarda lo que muestra el Radar en un archivo que cualquier app de calendario puede importar.',
  'radar.export.name': 'Radar de estrenos de Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} en {seconds}',
  'playerplus.settings.skip-delay': 'Esperar antes de saltar automáticamente',
  'playerplus.settings.skip-delay-hint': 'Para los segmentos en Automático: el botón Saltar hace antes una cuenta atrás. Pulsa cualquier tecla para detenerla y seguir viendo.',
  'playerplus.settings.skip-delay-none': 'Sin espera',
};
