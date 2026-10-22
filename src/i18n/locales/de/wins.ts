import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** German strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Von',
  'explore.filters.year-to': 'Bis',
  'explore.filters.runtime': 'Laufzeit',
  'explore.filters.runtime-min': 'Mindestens',
  'explore.filters.runtime-max': 'Höchstens',
  'explore.filters.minutes': '{count} Min.',
  'explore.filters.cast': 'Besetzung',
  'explore.filters.director': 'Regie oder Crew',
  'explore.filters.person-search': 'Personen suchen: {what}',
  'explore.filters.person-placeholder': 'Namen eingeben',
  'explore.filters.person-none': 'Niemand gefunden',
  'explore.filters.person-clear': '{name} entfernen',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Zurückspul-Puffer',
  'settings.player.rewind-hint': 'Wie viel vom Video im Speicher bleibt, damit Zurückspringen sofort geht. Mehr belegt während der Wiedergabe bis zu etwa 600 MB RAM, Maximal bis zu etwa 1,5 GB. Gilt ab dem nächsten Video.',
  'settings.player.rewind-standard': 'Standard',
  'settings.player.rewind-more': 'Mehr',
  'settings.player.rewind-most': 'Maximal',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Textdeckkraft',
  'subs.style.box-colour': 'Kastenfarbe',
  'subs.style.box-opacity': 'Kastendeckkraft',
  'subs.style.box-opacity-hint': 'Der Kasten hat eckige Ecken: Der Player kann keine abgerundeten zeichnen.',
  'subs.style.outline-colour': 'Konturfarbe',
  'player.subtitle-style.black': 'Schwarz',
  'player.subtitle-style.grey': 'Grau',
  'player.subtitle-style.navy': 'Marineblau',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Keine Antwort',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} installiert',
  'addons.health.installed.other': '{count} installiert',
  'addons.health.enabled.one': '{count} aktiviert',
  'addons.health.enabled.other': '{count} aktiviert',
  'addons.health.refresh': 'Add-on aktualisieren',
  'addons.health.refreshing': '{name} wird aktualisiert…',
  'addons.health.refreshed': '{name} wurde aktualisiert.',
  'addons.health.unchanged': '{name} hat geantwortet: nichts geändert.',
  'addons.health.refresh-failed': '{name} hat nicht geantwortet. Orbit nutzt weiter, was es hatte.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Mindestgröße',
  'sources.rules.min-size-hint': 'Für Filme; Folgen bekommen ein Drittel davon. Kleinere Dateien, oft Fälschungen oder im Kino abgefilmt, kommen nach allen anderen, werden aber nie ausgeblendet. Quellen ohne Größenangabe sind nicht betroffen.',
  'titles.why.under-size': 'Unter deinem Minimum von {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Sammlung finden',
  'collections.search.placeholder': 'Sammlung finden',
  'collections.search.none': 'Keine Sammlung passt',
  'collections.search.none-detail': 'Gesucht wird in Namen und Gruppen.',
  'collections.search.titles-label': 'Titel in dieser Sammlung finden',
  'collections.search.titles-placeholder': 'Titel finden',
  'collections.search.no-titles': 'Kein Titel passt',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'In Kalender exportieren (.ics)',
  'radar.export.hint': 'Speichert, was der Radar zeigt, als Datei, die jede Kalender-App importieren kann.',
  'radar.export.name': 'Orbit Release-Radar',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} in {seconds}',
  'playerplus.settings.skip-delay': 'Warten vor dem automatischen Überspringen',
  'playerplus.settings.skip-delay-hint': 'Für Abschnitte auf Automatisch: Die Überspringen-Taste zählt zuerst herunter. Eine beliebige Taste stoppt sie, und es geht normal weiter.',
  'playerplus.settings.skip-delay-none': 'Sofort',
};
