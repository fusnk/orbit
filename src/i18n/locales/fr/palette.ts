import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Palette de commandes',
  'palette.placeholder': 'Rechercher des titres, réglages, add-ons et actions',
  // Group headings
  'palette.group.recent': 'Récents',
  'palette.group.suggested': 'Suggestions',
  'palette.group.yours': 'Vos contenus',
  'palette.group.titles': 'Titres',
  'palette.group.settings': 'Réglages',
  'palette.group.addons': 'Add-ons',
  'palette.group.actions': 'Actions',
  // Titles from addons, while typing
  'palette.titles.searching': 'Recherche dans vos add-ons…',
  'palette.titles.none': 'Aucun titre trouvé',
  'palette.titles.none-can-search': 'Aucun de vos add-ons ne peut chercher',
  'palette.titles.failed': 'Vos add-ons n’ont pas pu chercher pour l’instant',
  'palette.search-all': 'Tous les résultats pour « {query} »',
  'palette.no-match': 'Rien ne correspond à « {query} »',
  // Where a title of yours was found
  'palette.from.continue': 'Reprendre',
  'palette.from.library': 'Dans votre bibliothèque',
  'palette.from.queue': 'Dans votre file',
  'palette.from.downloads': 'Téléchargé',
  'palette.from.watched': 'Vu',
  'palette.from.list': 'Liste',
  // What a result is
  'palette.kind.page': 'Page',
  'palette.kind.shortcut': 'Raccourci · {key}',
  'palette.kind.addon': 'Add-on',
  'palette.kind.category': 'Réglages',
  'palette.kind.setting': 'Réglages · {category}',
  'palette.setting-hidden': '« {setting} » apparaît quand vous modifiez « {parent} ».',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Série',
  'palette.kind.title': 'Titre',
  // Actions
  'palette.action.profile': 'Changer de profil',
  'palette.action.shortcuts': 'Raccourcis clavier',
  'palette.action.install-addon': 'Installer un add-on…',
  'palette.action.addon-updates': 'Rechercher des mises à jour des add-ons',
  // The key hints along the bottom
  'palette.hint.move': 'Déplacer',
  'palette.hint.open': 'Ouvrir',
  'palette.hint.groups': 'Groupe suivant',
  'palette.hint.close': 'Fermer',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'langue démarrage ouvrir fermer fenêtre zone de notification échelle zoom animations effets accessibilité alertes notifications sauvegarde restaurer diagnostic journaux importer trakt letterboxd',
  'palette.keywords.playback': 'lecture automatique épisode suivant reprendre passer générique bande-annonce',
  'palette.keywords.addons': 'installer boutique extensions plugins sources qualité torrents éviter privilégier',
  'palette.keywords.downloads': 'hors ligne stockage dossier qualité',
  'palette.keywords.appearance': 'thème couleurs accent police sombre clair fond d’écran ambiance logo styles',
  'palette.keywords.shortcuts': 'clavier raccourcis touches réattribuer',
  'palette.keywords.home-library': 'anime accueil rangées vu reprendre spoilers arcs narratifs bibliothèque métadonnées',
  'palette.keywords.subtitles': 'sous-titres langue forcés synchroniser malentendants paroles police taille couleur',
  'palette.keywords.picture-sound': 'image vidéo décodage matériel hdr audio son langue passthrough volume',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord services de streaming synchroniser compte debrid tmdb intégrations iptv tv en direct chaînes m3u xtream guide',
  // Settings → Shortcuts
  'palette.shortcut': 'Palette de commandes',
};
