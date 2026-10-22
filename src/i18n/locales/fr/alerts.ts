import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Nouveaux épisodes',
  'alerts.bell.unread.one': 'Nouveaux épisodes : {count} non lu',
  'alerts.bell.unread.other': 'Nouveaux épisodes : {count} non lus',
  'alerts.panel.heading': 'Nouveaux épisodes',
  'alerts.panel.mark-read': 'Tout marquer comme lu',
  'alerts.panel.empty': 'Rien de nouveau pour l’instant. Les nouveaux épisodes des séries que vous suivez apparaîtront ici.',
  'alerts.panel.play': 'Lire',
  'alerts.panel.play-label': 'Lire {show} S{season}É{episode}',
  'alerts.panel.aired': 'Diffusé le {date}',
  'alerts.toast.episode': 'S{season}É{episode} « {title} » est sorti',
  'alerts.toast.grouped-title': 'Nouveaux épisodes',
  'alerts.toast.grouped.one': '{count} nouvel épisode des séries que vous suivez : {shows}',
  'alerts.toast.grouped.other': '{count} nouveaux épisodes des séries que vous suivez : {shows}',
  'alerts.settings.enabled': 'Alertes de nouveaux épisodes',
  'alerts.settings.enabled-hint': 'La cloche de la barre de titre liste les épisodes diffusés depuis votre dernier passage. Vérifié au démarrage et toutes les quelques heures.',
  'alerts.settings.toasts': 'Afficher les notifications du système',
  'alerts.settings.toasts-hint': 'Une notification du système pour chaque nouvel épisode (une seule quand plusieurs arrivent en même temps), même quand Orbit est en arrière-plan.',
  'alerts.settings.scope': 'Alerter pour',
  'alerts.settings.scope-hint': 'Les séries que vous regardez sont celles de votre historique ; votre bibliothèque ajoute toutes les séries enregistrées.',
  'alerts.settings.scope-watching': 'Les séries que je regarde',
  'alerts.settings.scope-library': 'Tout ce qui est dans ma bibliothèque',
};
