import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Beste Übereinstimmung',
  'subs.error.sdh': 'Deine Einstellung für Hörgeschädigten-Text konnte nicht angewendet werden',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Text für Hörgeschädigte entfernen',
  'subs.settings.strip-sdh-hint': 'Blendet Geräuschbeschreibungen wie [Tür knarrt], Musikhinweise und Sprechernamen wie JOHN: in Untertiteln aus. Leer gewordene Zeilen werden übersprungen; das Timing bleibt gleich.',
  'subs.settings.keep-lyrics': 'Liedtexte behalten',
  'subs.settings.keep-lyrics-hint': 'Mit ♪ markierte gesungene Zeilen bleiben, wenn Text für Hörgeschädigte entfernt wird. Zeilen nur mit Musiknoten fallen trotzdem weg.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Untertitel konnten nicht unten gehalten werden',
  'subs.player.position': 'Untertitelposition',
  'subs.player.height': 'Höhe',
  'subs.player.raised': '{value} % höher',
  'subs.player.reset': 'Zurück nach unten',
  'subs.player.keep-bottom': 'Unten halten',
  'subs.player.keep-bottom-hint': 'Einfache Untertitel (wie SRT) ignorieren die Platzierung aus der Datei, sodass jede Zeile auf dieser Höhe steht. Im Video enthaltene einfache Untertitel verlieren zudem ihre Kursivschrift. Gestaltete Untertitel (ASS, häufig bei Anime) behalten ihr eigenes Layout. Gilt für alle Videos.',
};
