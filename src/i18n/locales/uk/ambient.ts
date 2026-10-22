import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': 'Фоновий режим',
  'ambient.hint.details': 'Enter — докладніше',
  'ambient.slide.resume': 'Продовжити',
  'ambient.slide.resume-episode': 'Продовжити {episode}',
  'ambient.slide.library': 'У моїй бібліотеці',
  'ambient.slide.recent': 'Нещодавно переглянуте',
  'ambient.slide.trending': 'Популярне зараз',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': 'Фоновий режим',
  'ambient.settings.after': 'Запускати через',
  'ambient.settings.after-hint': 'Якщо стільки часу нічого не натискати, Orbit переходить у неквапливе слайд-шоу з обкладинок. Ніколи — під час відтворення.',
  'ambient.settings.source': 'Що показувати',
  'ambient.settings.source-hint': 'Те, що ви дивитеся й зберегли, популярне або те й інше по черзі.',
  'ambient.settings.source-for-you': 'Для вас',
  'ambient.settings.source-trending': 'У тренді',
  'ambient.settings.source-both': 'Те й інше',
  'ambient.settings.clock': 'Показувати годинник',
  'ambient.settings.clock-hint': 'Час і дата в куті.',
  'ambient.settings.paused': 'Також на паузі',
  'ambient.settings.paused-hint': 'Запускається поверх плеєра, якщо він стільки часу стоїть на паузі. Відтворення залишається точно таким самим.',
  'ambient.settings.preview': 'Попередній перегляд',
  'ambient.settings.preview-label': 'Подивитися зараз',
  'ambient.settings.preview-hint': 'Одразу запускає фоновий режим. Натисніть будь-яку клавішу або рухніть мишею, щоб повернутися.',
};
