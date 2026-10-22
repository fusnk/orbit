import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Opdrachtenpalet',
  'palette.placeholder': 'Zoek titels, instellingen, add-ons en acties',
  // Group headings
  'palette.group.recent': 'Recent',
  'palette.group.suggested': 'Suggesties',
  'palette.group.yours': 'Jouw spullen',
  'palette.group.titles': 'Titels',
  'palette.group.settings': 'Instellingen',
  'palette.group.addons': 'Add-ons',
  'palette.group.actions': 'Acties',
  // Titles from addons, while typing
  'palette.titles.searching': 'Je add-ons doorzoeken…',
  'palette.titles.none': 'Geen titels gevonden',
  'palette.titles.none-can-search': 'Geen van je add-ons kan zoeken',
  'palette.titles.failed': 'Je add-ons konden nu niet zoeken',
  'palette.search-all': 'Alle resultaten voor “{query}”',
  'palette.no-match': 'Niets komt overeen met “{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Verder kijken',
  'palette.from.library': 'In je bibliotheek',
  'palette.from.queue': 'In je wachtrij',
  'palette.from.downloads': 'Gedownload',
  'palette.from.watched': 'Bekeken',
  'palette.from.list': 'Lijst',
  // What a result is
  'palette.kind.page': 'Pagina',
  'palette.kind.shortcut': 'Sneltoets · {key}',
  'palette.kind.addon': 'Add-on',
  'palette.kind.category': 'Instellingen',
  'palette.kind.setting': 'Instellingen · {category}',
  'palette.setting-hidden': '‘{setting}’ verschijnt zodra je ‘{parent}’ wijzigt.',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Serie',
  'palette.kind.title': 'Titel',
  // Actions
  'palette.action.profile': 'Van profiel wisselen',
  'palette.action.shortcuts': 'Sneltoetsen',
  'palette.action.install-addon': 'Een add-on installeren…',
  'palette.action.addon-updates': 'Add-ons op updates controleren',
  // The key hints along the bottom
  'palette.hint.move': 'Verplaatsen',
  'palette.hint.open': 'Openen',
  'palette.hint.groups': 'Volgende groep',
  'palette.hint.close': 'Sluiten',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'taal opstarten openen sluiten venster systeemvak schaal zoom beweging effecten toegankelijkheid meldingen notificaties back-up herstellen diagnose logboeken importeren trakt letterboxd',
  'palette.keywords.playback': 'automatisch afspelen volgende aflevering hervatten intro overslaan trailer',
  'palette.keywords.addons': 'installeren winkel extensies plug-ins bronnen kwaliteit torrents vermijden voorkeur',
  'palette.keywords.downloads': 'offline opslag map kwaliteit',
  'palette.keywords.appearance': 'thema kleuren accent lettertype donker licht achtergrond sfeer logo stijlen',
  'palette.keywords.shortcuts': 'toetsenbord sneltoetsen toetsen opnieuw toewijzen',
  'palette.keywords.home-library': 'anime home rijen bekeken verder kijken spoilers verhaallijnen bibliotheek metadata',
  'palette.keywords.subtitles': 'ondertiteling taal geforceerd synchroniseren slechthorenden songteksten lettertype grootte kleur',
  'palette.keywords.picture-sound': 'beeld video hardwaredecodering hdr audio geluid taal passthrough volume',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord streamingdiensten synchroniseren account debrid tmdb integraties iptv live tv zenders m3u xtream gids',
  // Settings → Shortcuts
  'palette.shortcut': 'Opdrachtenpalet',
};
