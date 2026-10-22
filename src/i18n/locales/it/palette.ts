import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Tavolozza dei comandi',
  'palette.placeholder': 'Cerca titoli, impostazioni, componenti aggiuntivi e azioni',
  // Group headings
  'palette.group.recent': 'Recenti',
  'palette.group.suggested': 'Suggerimenti',
  'palette.group.yours': 'I tuoi contenuti',
  'palette.group.titles': 'Titoli',
  'palette.group.settings': 'Impostazioni',
  'palette.group.addons': 'Componenti aggiuntivi',
  'palette.group.actions': 'Azioni',
  // Titles from addons, while typing
  'palette.titles.searching': 'Ricerca nei tuoi componenti aggiuntivi…',
  'palette.titles.none': 'Nessun titolo trovato',
  'palette.titles.none-can-search': 'Nessuno dei tuoi componenti aggiuntivi può cercare',
  'palette.titles.failed': 'I tuoi componenti aggiuntivi non sono riusciti a cercare ora',
  'palette.search-all': 'Tutti i risultati per “{query}”',
  'palette.no-match': 'Niente corrisponde a “{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Continua a guardare',
  'palette.from.library': 'Nella tua libreria',
  'palette.from.queue': 'Nella tua coda',
  'palette.from.downloads': 'Scaricato',
  'palette.from.watched': 'Visto',
  'palette.from.list': 'Lista',
  // What a result is
  'palette.kind.page': 'Pagina',
  'palette.kind.shortcut': 'Scorciatoia · {key}',
  'palette.kind.addon': 'Componente aggiuntivo',
  'palette.kind.category': 'Impostazioni',
  'palette.kind.setting': 'Impostazioni · {category}',
  'palette.setting-hidden': '«{setting}» compare quando cambi «{parent}».',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Serie',
  'palette.kind.title': 'Titolo',
  // Actions
  'palette.action.profile': 'Cambia profilo',
  'palette.action.shortcuts': 'Scorciatoie da tastiera',
  'palette.action.install-addon': 'Installa un componente aggiuntivo…',
  'palette.action.addon-updates': 'Cerca aggiornamenti dei componenti aggiuntivi',
  // The key hints along the bottom
  'palette.hint.move': 'Sposta',
  'palette.hint.open': 'Apri',
  'palette.hint.groups': 'Gruppo successivo',
  'palette.hint.close': 'Chiudi',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'lingua avvio aprire chiudere finestra area di notifica scala zoom animazioni effetti accessibilità avvisi notifiche backup ripristino diagnostica log importare trakt letterboxd',
  'palette.keywords.playback': 'riproduzione automatica episodio successivo riprendi salta sigla trailer',
  'palette.keywords.addons': 'installare negozio estensioni plugin fonti qualità torrent evitare preferire',
  'palette.keywords.downloads': 'offline spazio cartella qualità',
  'palette.keywords.appearance': 'tema colori accento carattere scuro chiaro sfondo ambiente logo stili',
  'palette.keywords.shortcuts': 'tastiera scorciatoie tasti riassegnare',
  'palette.keywords.home-library': 'anime home righe visto continua a guardare spoiler archi narrativi libreria metadati',
  'palette.keywords.subtitles': 'sottotitoli lingua forzati sincronizzare non udenti testi carattere dimensione colore',
  'palette.keywords.picture-sound': 'immagine video decodifica hardware hdr audio suono lingua passthrough volume',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord servizi di streaming sincronizzare account debrid tmdb integrazioni iptv tv in diretta canali m3u xtream guida',
  // Settings → Shortcuts
  'palette.shortcut': 'Tavolozza dei comandi',
};
