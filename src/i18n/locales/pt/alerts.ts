import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Episódios novos',
  'alerts.bell.unread.one': 'Episódios novos: {count} não lido',
  'alerts.bell.unread.other': 'Episódios novos: {count} não lidos',
  'alerts.panel.heading': 'Episódios novos',
  'alerts.panel.mark-read': 'Marcar tudo como lido',
  'alerts.panel.empty': 'Nada de novo por enquanto. Os episódios novos das séries que você acompanha aparecem aqui.',
  'alerts.panel.play': 'Assistir',
  'alerts.panel.play-label': 'Assistir {show} T{season}E{episode}',
  'alerts.panel.aired': 'Exibido em {date}',
  'alerts.toast.episode': 'T{season}E{episode} “{title}” já está disponível',
  'alerts.toast.grouped-title': 'Episódios novos',
  'alerts.toast.grouped.one': '{count} episódio novo de séries que você acompanha: {shows}',
  'alerts.toast.grouped.other': '{count} episódios novos de séries que você acompanha: {shows}',
  'alerts.settings.enabled': 'Alertas de episódios novos',
  'alerts.settings.enabled-hint': 'O sino na barra de título lista os episódios exibidos desde a última vez que você olhou. Verificado ao iniciar e a cada poucas horas.',
  'alerts.settings.toasts': 'Mostrar notificações do sistema',
  'alerts.settings.toasts-hint': 'Uma notificação do sistema para cada episódio novo (uma só quando vários chegam de uma vez), mesmo com o Orbit em segundo plano.',
  'alerts.settings.scope': 'Avisar sobre',
  'alerts.settings.scope-hint': 'As séries que você assiste são as do seu histórico; a biblioteca inclui todas as séries salvas.',
  'alerts.settings.scope-watching': 'Séries que estou assistindo',
  'alerts.settings.scope-library': 'Tudo na minha biblioteca',
};
