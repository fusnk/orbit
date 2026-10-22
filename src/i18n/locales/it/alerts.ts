import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Nuovi episodi',
  'alerts.bell.unread.one': 'Nuovi episodi: {count} da leggere',
  'alerts.bell.unread.other': 'Nuovi episodi: {count} da leggere',
  'alerts.panel.heading': 'Nuovi episodi',
  'alerts.panel.mark-read': 'Segna tutti come letti',
  'alerts.panel.empty': 'Ancora niente di nuovo. I nuovi episodi delle serie che segui compaiono qui.',
  'alerts.panel.play': 'Riproduci',
  'alerts.panel.play-label': 'Riproduci {show} S{season}E{episode}',
  'alerts.panel.aired': 'In onda il {date}',
  'alerts.toast.episode': 'È uscito S{season}E{episode} “{title}”',
  'alerts.toast.grouped-title': 'Nuovi episodi',
  'alerts.toast.grouped.one': '{count} nuovo episodio dalle serie che segui: {shows}',
  'alerts.toast.grouped.other': '{count} nuovi episodi dalle serie che segui: {shows}',
  'alerts.settings.enabled': 'Avvisi sui nuovi episodi',
  'alerts.settings.enabled-hint': 'La campanella nella barra del titolo elenca gli episodi andati in onda dall’ultima volta che hai guardato. Controllo all’avvio e ogni poche ore.',
  'alerts.settings.toasts': 'Mostra notifiche di sistema',
  'alerts.settings.toasts-hint': 'Una notifica di sistema per ogni nuovo episodio (una sola quando ne arrivano diversi insieme), anche con Orbit in secondo piano.',
  'alerts.settings.scope': 'Avvisa per',
  'alerts.settings.scope-hint': 'Le serie che guardi sono quelle nella cronologia; la libreria aggiunge tutte le serie salvate.',
  'alerts.settings.scope-watching': 'Le serie che sto guardando',
  'alerts.settings.scope-library': 'Tutto ciò che è nella mia libreria',
};
