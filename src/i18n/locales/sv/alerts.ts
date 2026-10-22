import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Nya avsnitt',
  'alerts.bell.unread.one': 'Nya avsnitt: {count} oläst',
  'alerts.bell.unread.other': 'Nya avsnitt: {count} olästa',
  'alerts.panel.heading': 'Nya avsnitt',
  'alerts.panel.mark-read': 'Markera alla som lästa',
  'alerts.panel.empty': 'Inget nytt än. Nya avsnitt av serier du följer visas här.',
  'alerts.panel.play': 'Spela upp',
  'alerts.panel.play-label': 'Spela upp {show} S{season}A{episode}',
  'alerts.panel.aired': 'Sändes {date}',
  'alerts.toast.episode': 'S{season}A{episode} ”{title}” är ute',
  'alerts.toast.grouped-title': 'Nya avsnitt',
  'alerts.toast.grouped.one': '{count} nytt avsnitt från serier du följer: {shows}',
  'alerts.toast.grouped.other': '{count} nya avsnitt från serier du följer: {shows}',
  'alerts.settings.enabled': 'Aviseringar om nya avsnitt',
  'alerts.settings.enabled-hint': 'Klockan i namnlisten visar avsnitt som har sänts sedan du senast tittade. Kontrolleras vid start och med några timmars mellanrum.',
  'alerts.settings.toasts': 'Visa skrivbordsaviseringar',
  'alerts.settings.toasts-hint': 'En systemavisering för varje nytt avsnitt (en för alla när flera kommer samtidigt), även när Orbit körs i bakgrunden.',
  'alerts.settings.scope': 'Avisera för',
  'alerts.settings.scope-hint': 'Serier du tittar på är serierna i din historik; ditt bibliotek lägger till alla sparade serier.',
  'alerts.settings.scope-watching': 'Serier jag tittar på',
  'alerts.settings.scope-library': 'Allt i mitt bibliotek',
};
