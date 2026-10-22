import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Nieuwe afleveringen',
  'alerts.bell.unread.one': 'Nieuwe afleveringen: {count} ongelezen',
  'alerts.bell.unread.other': 'Nieuwe afleveringen: {count} ongelezen',
  'alerts.panel.heading': 'Nieuwe afleveringen',
  'alerts.panel.mark-read': 'Alles als gelezen markeren',
  'alerts.panel.empty': 'Nog niets nieuws. Nieuwe afleveringen van series die je volgt verschijnen hier.',
  'alerts.panel.play': 'Afspelen',
  'alerts.panel.play-label': '{show} S{season}A{episode} afspelen',
  'alerts.panel.aired': 'Uitgezonden op {date}',
  'alerts.toast.episode': 'S{season}A{episode} ‘{title}’ is uit',
  'alerts.toast.grouped-title': 'Nieuwe afleveringen',
  'alerts.toast.grouped.one': '{count} nieuwe aflevering van series die je volgt: {shows}',
  'alerts.toast.grouped.other': '{count} nieuwe afleveringen van series die je volgt: {shows}',
  'alerts.settings.enabled': 'Meldingen over nieuwe afleveringen',
  'alerts.settings.enabled-hint': 'De bel in de titelbalk toont afleveringen die zijn uitgezonden sinds je laatst keek. Gecontroleerd bij het starten en om de paar uur.',
  'alerts.settings.toasts': 'Systeemmeldingen tonen',
  'alerts.settings.toasts-hint': 'Een systeemmelding per nieuwe aflevering (één voor alles als er meerdere tegelijk komen), ook als Orbit op de achtergrond draait.',
  'alerts.settings.scope': 'Melden voor',
  'alerts.settings.scope-hint': 'Series die je kijkt zijn die in je geschiedenis; je bibliotheek voegt elke opgeslagen serie toe.',
  'alerts.settings.scope-watching': 'Series die ik kijk',
  'alerts.settings.scope-library': 'Alles in mijn bibliotheek',
};
