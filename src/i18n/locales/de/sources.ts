import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Grenzen für automatisches Abspielen',
  'sources.limits.any': 'Beliebig',
  'sources.limits.min-quality': 'Automatische Wiedergabe startet nicht unter',
  'sources.limits.min-quality-hint': 'Abspielen und die nächste Folge starten nur Quellen in mindestens dieser Qualität (Quellen ohne Angabe nicht). Passt keine, läuft die beste und Orbit sagt es dir. Die Quellenliste zeigt weiterhin alles. Für dieses Profil.',
  'sources.limits.max-quality': 'Automatische Wiedergabe startet nicht über',
  'sources.limits.max-quality-hint': 'Abspielen und die nächste Folge starten keine Quellen darüber, außer es gibt nichts anderes. Anders als „Höchste bevorzugte Qualität“ ändert es die Reihenfolge der Quellenliste nicht. Für dieses Profil.',
  'sources.limits.max-size': 'Automatische Wiedergabe startet keine Dateien über',
  'sources.limits.max-size-hint': 'Für langsame Verbindungen oder begrenztes Datenvolumen: Abspielen und die nächste Folge überspringen größere Dateien. Quellen ohne Größenangabe sind nicht betroffen. Für dieses Profil.',
  'sources.autoplay.outside-limits': 'Nichts passt zu deinen Grenzen für automatisches Abspielen, daher läuft die beste Quelle.',
  'sources.autoplay.only-uncached': 'Alle gefundenen Quellen werden noch auf deinen Debrid-Dienst geladen. Wähle eine, um sie zu starten.',
  'sources.note.uncached': 'Nicht gecacht',
  'sources.note.uncached-hint': 'Wird noch auf deinen Debrid-Dienst geladen: startet nie automatisch',
  'sources.note.outside-limits': 'Außerhalb der Grenzen',
  'sources.note.outside-limits-hint': 'Abspielen und die nächste Folge übergehen sie (Einstellungen → Add-ons & Quellen → Quellen-Einstellungen → Grenzen für automatisches Abspielen)',
  'sources.next-up.unaired': 'Als Nächstes · Sendetermin nicht bestätigt',
};
