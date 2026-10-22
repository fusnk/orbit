import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Neue Folgen',
  'alerts.bell.unread.one': 'Neue Folgen: {count} ungelesen',
  'alerts.bell.unread.other': 'Neue Folgen: {count} ungelesen',
  'alerts.panel.heading': 'Neue Folgen',
  'alerts.panel.mark-read': 'Alle als gelesen markieren',
  'alerts.panel.empty': 'Noch nichts Neues. Neue Folgen von Serien, denen du folgst, erscheinen hier.',
  'alerts.panel.play': 'Abspielen',
  'alerts.panel.play-label': '{show} S{season}F{episode} abspielen',
  'alerts.panel.aired': 'Ausgestrahlt am {date}',
  'alerts.toast.episode': 'S{season}F{episode} „{title}“ ist da',
  'alerts.toast.grouped-title': 'Neue Folgen',
  'alerts.toast.grouped.one': '{count} neue Folge von Serien, denen du folgst: {shows}',
  'alerts.toast.grouped.other': '{count} neue Folgen von Serien, denen du folgst: {shows}',
  'alerts.settings.enabled': 'Hinweise auf neue Folgen',
  'alerts.settings.enabled-hint': 'Die Glocke in der Titelleiste listet Folgen, die seit deinem letzten Blick ausgestrahlt wurden. Geprüft beim Start und alle paar Stunden.',
  'alerts.settings.toasts': 'Systembenachrichtigungen anzeigen',
  'alerts.settings.toasts-hint': 'Eine Systembenachrichtigung je neuer Folge (eine für alle, wenn mehrere auf einmal kommen), auch wenn Orbit im Hintergrund läuft.',
  'alerts.settings.scope': 'Hinweise für',
  'alerts.settings.scope-hint': 'Serien, die du schaust, sind die aus deinem Verlauf; deine Bibliothek ergänzt alle gespeicherten Serien.',
  'alerts.settings.scope-watching': 'Serien, die ich schaue',
  'alerts.settings.scope-library': 'Alles in Meiner Bibliothek',
};
