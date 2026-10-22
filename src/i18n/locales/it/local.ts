import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Rilascia per riprodurre',
  'local.drop.video-hint': 'Il video viene riprodotto in Orbit.',
  'local.drop.subtitle-hint': 'I sottotitoli vengono aggiunti a ciò che è in riproduzione.',
  'local.drop.first-only': 'Riproduzione di {name}. Orbit riproduce un file alla volta, quindi gli altri sono stati ignorati.',
  'local.drop.failed': 'Impossibile aprire quel file.',
  'local.drop.unsupported': 'Orbit non può riprodurre quel tipo di file.',
  'local.drop.subtitle-needs-player': 'Avvia prima un video, poi rilascia i sottotitoli sopra.',
  'local.drop.subtitle-added': 'Sottotitoli aggiunti: {name}',
  'local.drop.subtitle-first-only': 'Sottotitoli aggiunti: {name}. È stato usato solo il primo file.',
  'local.drop.subtitle-failed': 'Impossibile aggiungere quei sottotitoli.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'questo PC',
  'local.source.label': 'File locale',
  // Settings → Player → External player
  'local.external.heading': 'Lettore esterno',
  'local.external.player': 'Apri le fonti in',
  'local.external.player-hint': 'Aggiunge «Apri nel lettore esterno» alle fonti web nel selettore delle fonti. Ripresa, salta intro, tracce ricordate e avanzamento funzionano solo nel lettore di Orbit.',
  'local.external.none': 'Nessuno',
  'local.external.custom': 'Personalizzato',
  'local.external.found': 'Trovato: {path}',
  'local.external.not-found': 'Non trovato nella solita cartella di installazione. Scegli Personalizzato per indicarne la posizione.',
  'local.external.custom-path': 'Programma',
  'local.external.custom-path-hint': 'Il file del programma del lettore, scelto su questo PC.',
  'local.external.choose': 'Scegli…',
  'local.external.custom-invalid': 'Orbit non riesce ad avviarlo. Scegli il file del programma del lettore.',
  'local.external.always': 'Apri sempre nel lettore esterno',
  'local.external.always-hint': 'Riproduci invia direttamente la fonte web migliore. Torrent e download restano in Orbit.',
  // The source picker
  'local.external.open': 'Esterno',
  'local.external.open-label': 'Apri nel lettore esterno',
  'local.external.opened': 'Aperto nel lettore esterno.',
  'local.external.failed': 'Il lettore esterno non si è avviato. Controlla Impostazioni → Player.',
};
