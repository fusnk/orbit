import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** French strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'De',
  'explore.filters.year-to': 'À',
  'explore.filters.runtime': 'Durée',
  'explore.filters.runtime-min': 'Au moins',
  'explore.filters.runtime-max': 'Au plus',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Distribution',
  'explore.filters.director': 'Réalisation ou équipe',
  'explore.filters.person-search': 'Chercher une personne : {what}',
  'explore.filters.person-placeholder': 'Saisissez un nom',
  'explore.filters.person-none': 'Aucune personne trouvée',
  'explore.filters.person-clear': 'Retirer {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Cache de retour arrière',
  'settings.player.rewind-hint': 'La part de la vidéo gardée en mémoire, pour revenir en arrière instantanément. Plus utilise jusqu’à environ 600 Mo de RAM pendant la lecture, Maximum jusqu’à environ 1,5 Go. S’applique à la prochaine vidéo.',
  'settings.player.rewind-standard': 'Standard',
  'settings.player.rewind-more': 'Plus',
  'settings.player.rewind-most': 'Maximum',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Opacité du texte',
  'subs.style.box-colour': 'Couleur du fond',
  'subs.style.box-opacity': 'Opacité du fond',
  'subs.style.box-opacity-hint': 'Le fond a des coins droits : le lecteur ne sait pas les arrondir.',
  'subs.style.outline-colour': 'Couleur du contour',
  'player.subtitle-style.black': 'Noir',
  'player.subtitle-style.grey': 'Gris',
  'player.subtitle-style.navy': 'Bleu marine',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'N’a pas répondu',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} installé',
  'addons.health.installed.other': '{count} installés',
  'addons.health.enabled.one': '{count} activé',
  'addons.health.enabled.other': '{count} activés',
  'addons.health.refresh': 'Actualiser l’add-on',
  'addons.health.refreshing': 'Actualisation de {name}…',
  'addons.health.refreshed': '{name} a été mis à jour.',
  'addons.health.unchanged': '{name} a répondu : rien n’a changé.',
  'addons.health.refresh-failed': '{name} n’a pas répondu. Orbit garde ce qu’il avait.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Taille minimale',
  'sources.rules.min-size-hint': 'Pour les films ; un tiers pour les épisodes. Les fichiers plus petits, souvent des faux ou des copies filmées en salle, passent après tous les autres, sans jamais être masqués. Les sources qui n’indiquent pas leur taille ne sont pas concernées.',
  'titles.why.under-size': 'Sous votre minimum de {size} Go',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Trouver une collection',
  'collections.search.placeholder': 'Trouver une collection',
  'collections.search.none': 'Aucune collection ne correspond',
  'collections.search.none-detail': 'La recherche porte sur les noms et les groupes.',
  'collections.search.titles-label': 'Trouver un titre dans cette collection',
  'collections.search.titles-placeholder': 'Trouver un titre',
  'collections.search.no-titles': 'Aucun titre ne correspond',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Exporter vers un agenda (.ics)',
  'radar.export.hint': 'Enregistre ce qu’affiche le Radar dans un fichier que toute application d’agenda peut importer.',
  'radar.export.name': 'Radar des sorties Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} dans {seconds}',
  'playerplus.settings.skip-delay': 'Attendre avant de passer automatiquement',
  'playerplus.settings.skip-delay-hint': 'Pour les passages en Automatique : le bouton Passer fait d’abord un compte à rebours. Appuyez sur n’importe quelle touche pour l’arrêter et regarder.',
  'playerplus.settings.skip-delay-none': 'Sans attendre',
};
