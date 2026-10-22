import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Episodios nuevos',
  'alerts.bell.unread.one': 'Episodios nuevos: {count} sin leer',
  'alerts.bell.unread.other': 'Episodios nuevos: {count} sin leer',
  'alerts.panel.heading': 'Episodios nuevos',
  'alerts.panel.mark-read': 'Marcar todo como leído',
  'alerts.panel.empty': 'Nada nuevo por ahora. Los episodios nuevos de las series que sigues aparecerán aquí.',
  'alerts.panel.play': 'Reproducir',
  'alerts.panel.play-label': 'Reproducir {show} T{season}E{episode}',
  'alerts.panel.aired': 'Emitido el {date}',
  'alerts.toast.episode': 'Ya está disponible T{season}E{episode} «{title}»',
  'alerts.toast.grouped-title': 'Episodios nuevos',
  'alerts.toast.grouped.one': '{count} episodio nuevo de series que sigues: {shows}',
  'alerts.toast.grouped.other': '{count} episodios nuevos de series que sigues: {shows}',
  'alerts.settings.enabled': 'Avisos de episodios nuevos',
  'alerts.settings.enabled-hint': 'La campana de la barra de título muestra los episodios emitidos desde la última vez que miraste. Se comprueba al iniciar y cada pocas horas.',
  'alerts.settings.toasts': 'Mostrar notificaciones del sistema',
  'alerts.settings.toasts-hint': 'Una notificación del sistema por cada episodio nuevo (una sola cuando llegan varios a la vez), incluso con Orbit en segundo plano.',
  'alerts.settings.scope': 'Avisar de',
  'alerts.settings.scope-hint': 'Las series que ves son las de tu historial; tu biblioteca añade todas las series guardadas.',
  'alerts.settings.scope-watching': 'Series que estoy viendo',
  'alerts.settings.scope-library': 'Todo lo de mi biblioteca',
};
