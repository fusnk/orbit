import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Zum Abspielen ablegen',
  'local.drop.video-hint': 'Das Video wird in Orbit abgespielt.',
  'local.drop.subtitle-hint': 'Die Untertitel werden zur laufenden Wiedergabe hinzugefügt.',
  'local.drop.first-only': '{name} wird abgespielt. Orbit spielt jeweils eine Datei ab, die übrigen wurden ausgelassen.',
  'local.drop.failed': 'Die Datei konnte nicht geöffnet werden.',
  'local.drop.unsupported': 'Diese Art von Datei kann Orbit nicht abspielen.',
  'local.drop.subtitle-needs-player': 'Starte zuerst ein Video und lege die Untertitel dann darauf ab.',
  'local.drop.subtitle-added': 'Untertitel hinzugefügt: {name}',
  'local.drop.subtitle-first-only': 'Untertitel hinzugefügt: {name}. Nur die erste Datei wurde verwendet.',
  'local.drop.subtitle-failed': 'Die Untertitel konnten nicht hinzugefügt werden.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'diesem PC',
  'local.source.label': 'Lokale Datei',
  // Settings → Player → External player
  'local.external.heading': 'Externer Player',
  'local.external.player': 'Quellen öffnen in',
  'local.external.player-hint': 'Fügt Webquellen in der Quellenauswahl „In externem Player öffnen“ hinzu. Fortsetzen, Intro überspringen, gemerkte Spuren und Fortschritt gibt es nur in Orbits eigenem Player.',
  'local.external.none': 'Keiner',
  'local.external.custom': 'Eigener',
  'local.external.found': 'Gefunden: {path}',
  'local.external.not-found': 'Nicht im üblichen Installationsordner gefunden. Wähle „Eigener“, um den Ort anzugeben.',
  'local.external.custom-path': 'Programm',
  'local.external.custom-path-hint': 'Die Programmdatei des Players, auf diesem PC ausgewählt.',
  'local.external.choose': 'Auswählen…',
  'local.external.custom-invalid': 'Das kann Orbit nicht starten. Wähle die Programmdatei des Players.',
  'local.external.always': 'Immer im externen Player öffnen',
  'local.external.always-hint': 'Abspielen übergibt die beste Webquelle direkt an ihn. Torrents und Downloads laufen weiter in Orbit.',
  // The source picker
  'local.external.open': 'Extern',
  'local.external.open-label': 'In externem Player öffnen',
  'local.external.opened': 'Im externen Player geöffnet.',
  'local.external.failed': 'Der externe Player ist nicht gestartet. Sieh unter Einstellungen → Player nach.',
};
