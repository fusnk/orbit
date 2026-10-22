import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** Italian strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Dal',
  'explore.filters.year-to': 'Al',
  'explore.filters.runtime': 'Durata',
  'explore.filters.runtime-min': 'Almeno',
  'explore.filters.runtime-max': 'Al massimo',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Cast',
  'explore.filters.director': 'Regia o troupe',
  'explore.filters.person-search': 'Cerca persone: {what}',
  'explore.filters.person-placeholder': 'Scrivi un nome',
  'explore.filters.person-none': 'Nessuno trovato',
  'explore.filters.person-clear': 'Rimuovi {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Cache per tornare indietro',
  'settings.player.rewind-hint': 'Quanta parte del video resta in memoria, così tornare indietro è immediato. Di più usa fino a circa 600 MB di RAM durante la riproduzione, Massimo fino a circa 1,5 GB. Vale dal prossimo video.',
  'settings.player.rewind-standard': 'Standard',
  'settings.player.rewind-more': 'Di più',
  'settings.player.rewind-most': 'Massimo',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Opacità del testo',
  'subs.style.box-colour': 'Colore del riquadro',
  'subs.style.box-opacity': 'Opacità del riquadro',
  'subs.style.box-opacity-hint': 'Il riquadro ha angoli retti: il lettore non può disegnarli arrotondati.',
  'subs.style.outline-colour': 'Colore del contorno',
  'player.subtitle-style.black': 'Nero',
  'player.subtitle-style.grey': 'Grigio',
  'player.subtitle-style.navy': 'Blu navy',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Non ha risposto',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} installato',
  'addons.health.installed.other': '{count} installati',
  'addons.health.enabled.one': '{count} attivo',
  'addons.health.enabled.other': '{count} attivi',
  'addons.health.refresh': 'Aggiorna componente aggiuntivo',
  'addons.health.refreshing': 'Aggiornamento di {name}…',
  'addons.health.refreshed': '{name} è stato aggiornato.',
  'addons.health.unchanged': '{name} ha risposto: nessuna modifica.',
  'addons.health.refresh-failed': '{name} non ha risposto. Orbit continua a usare ciò che aveva.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Dimensione minima',
  'sources.rules.min-size-hint': 'Per i film; gli episodi ne hanno un terzo. I file più piccoli, spesso falsi o registrati al cinema, vanno dopo tutti gli altri, ma non vengono mai nascosti. Le fonti che non indicano la dimensione non sono interessate.',
  'titles.why.under-size': 'Sotto il tuo minimo di {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Trova una raccolta',
  'collections.search.placeholder': 'Trova una raccolta',
  'collections.search.none': 'Nessuna raccolta corrisponde',
  'collections.search.none-detail': 'La ricerca riguarda nomi e gruppi.',
  'collections.search.titles-label': 'Trova un titolo in questa raccolta',
  'collections.search.titles-placeholder': 'Trova un titolo',
  'collections.search.no-titles': 'Nessun titolo corrisponde',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Esporta nel calendario (.ics)',
  'radar.export.hint': 'Salva ciò che mostra il Radar in un file che qualsiasi app di calendario può importare.',
  'radar.export.name': 'Radar delle uscite di Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} tra {seconds}',
  'playerplus.settings.skip-delay': 'Attendi prima di saltare automaticamente',
  'playerplus.settings.skip-delay-hint': 'Per i segmenti su Automatico: il pulsante Salta fa prima un conto alla rovescia. Premi un tasto qualsiasi per fermarlo e guardare.',
  'playerplus.settings.skip-delay-none': 'Subito',
};
