import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Nové díly',
  'alerts.bell.unread.one': 'Nové díly: {count} nepřečtený',
  'alerts.bell.unread.few': 'Nové díly: {count} nepřečtené',
  'alerts.bell.unread.other': 'Nové díly: {count} nepřečtených',
  'alerts.panel.heading': 'Nové díly',
  'alerts.panel.mark-read': 'Označit vše jako přečtené',
  'alerts.panel.empty': 'Zatím nic nového. Objeví se tu nové díly seriálů, které sledujete.',
  'alerts.panel.play': 'Přehrát',
  'alerts.panel.play-label': 'Přehrát {show} S{season}E{episode}',
  'alerts.panel.aired': 'Vysíláno {date}',
  'alerts.toast.episode': 'S{season}E{episode} „{title}“ je venku',
  'alerts.toast.grouped-title': 'Nové díly',
  'alerts.toast.grouped.one': '{count} nový díl ze seriálů, které sledujete: {shows}',
  'alerts.toast.grouped.few': '{count} nové díly ze seriálů, které sledujete: {shows}',
  'alerts.toast.grouped.other': '{count} nových dílů ze seriálů, které sledujete: {shows}',
  'alerts.settings.enabled': 'Upozornění na nové díly',
  'alerts.settings.enabled-hint': 'Zvonek v záhlaví okna ukazuje díly odvysílané od vaší poslední návštěvy. Kontroluje se při spuštění a každých pár hodin.',
  'alerts.settings.toasts': 'Zobrazovat systémová oznámení',
  'alerts.settings.toasts-hint': 'Systémové oznámení ke každému novému dílu (jedno společné, když jich přijde víc najednou), i když Orbit běží na pozadí.',
  'alerts.settings.scope': 'Upozorňovat na',
  'alerts.settings.scope-hint': 'Sledované seriály jsou ty z vaší historie; knihovna přidá všechny uložené seriály.',
  'alerts.settings.scope-watching': 'Seriály, které sleduji',
  'alerts.settings.scope-library': 'Vše v mé knihovně',
};
