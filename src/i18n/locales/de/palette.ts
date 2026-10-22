import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Befehlspalette',
  'palette.placeholder': 'Titel, Einstellungen, Add-ons und Aktionen suchen',
  // Group headings
  'palette.group.recent': 'Zuletzt',
  'palette.group.suggested': 'Vorschläge',
  'palette.group.yours': 'Deine Inhalte',
  'palette.group.titles': 'Titel',
  'palette.group.settings': 'Einstellungen',
  'palette.group.addons': 'Add-ons',
  'palette.group.actions': 'Aktionen',
  // Titles from addons, while typing
  'palette.titles.searching': 'Deine Add-ons werden durchsucht …',
  'palette.titles.none': 'Keine Titel gefunden',
  'palette.titles.none-can-search': 'Keines deiner Add-ons kann suchen',
  'palette.titles.failed': 'Deine Add-ons konnten gerade nicht suchen',
  'palette.search-all': 'Alle Ergebnisse für „{query}“',
  'palette.no-match': 'Nichts passt zu „{query}“',
  // Where a title of yours was found
  'palette.from.continue': 'Weiterschauen',
  'palette.from.library': 'In deiner Bibliothek',
  'palette.from.queue': 'In deiner Warteschlange',
  'palette.from.downloads': 'Heruntergeladen',
  'palette.from.watched': 'Gesehen',
  'palette.from.list': 'Liste',
  // What a result is
  'palette.kind.page': 'Seite',
  'palette.kind.shortcut': 'Tastenkürzel · {key}',
  'palette.kind.addon': 'Add-on',
  'palette.kind.category': 'Einstellungen',
  'palette.kind.setting': 'Einstellungen · {category}',
  'palette.setting-hidden': '„{setting}“ erscheint, sobald du „{parent}“ änderst.',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Serie',
  'palette.kind.title': 'Titel',
  // Actions
  'palette.action.profile': 'Profil wechseln',
  'palette.action.shortcuts': 'Tastenkürzel',
  'palette.action.install-addon': 'Add-on installieren …',
  'palette.action.addon-updates': 'Add-ons auf Updates prüfen',
  // The key hints along the bottom
  'palette.hint.move': 'Bewegen',
  'palette.hint.open': 'Öffnen',
  'palette.hint.groups': 'Nächste Gruppe',
  'palette.hint.close': 'Schließen',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'Sprache Start öffnen schließen Fenster Infobereich Skalierung Zoom Bewegung Effekte Barrierefreiheit Hinweise Benachrichtigungen Sicherung wiederherstellen Diagnose Protokolle importieren trakt letterboxd',
  'palette.keywords.playback': 'automatische Wiedergabe nächste Folge fortsetzen Intro überspringen Trailer',
  'palette.keywords.addons': 'installieren Store Erweiterungen Plugins Quellen Qualität Torrents meiden bevorzugen',
  'palette.keywords.downloads': 'offline Speicher Ordner Qualität',
  'palette.keywords.appearance': 'Design Farben Akzent Schrift dunkel hell Hintergrund Ambient Logo Looks',
  'palette.keywords.shortcuts': 'Tastatur Tastenkürzel Tasten neu belegen',
  'palette.keywords.home-library': 'Anime Startseite Reihen gesehen weiterschauen Spoiler Handlungsbögen Bibliothek Metadaten',
  'palette.keywords.subtitles': 'Untertitel Sprache erzwungen synchronisieren Hörgeschädigte Liedtexte Schrift Größe Farbe',
  'palette.keywords.picture-sound': 'Bild Video Hardware-Dekodierung hdr Audio Ton Sprache Passthrough Lautstärke',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord Streamingdienste synchronisieren Konto debrid tmdb Integrationen iptv Live-TV Sender m3u xtream Programm',
  // Settings → Shortcuts
  'palette.shortcut': 'Befehlspalette',
};
