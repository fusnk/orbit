import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': 'Фоновый режим',
  'ambient.hint.details': 'Enter — подробнее',
  'ambient.slide.resume': 'Продолжить',
  'ambient.slide.resume-episode': 'Продолжить {episode}',
  'ambient.slide.library': 'В моей библиотеке',
  'ambient.slide.recent': 'Недавно просмотренное',
  'ambient.slide.trending': 'Популярно сейчас',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': 'Фоновый режим',
  'ambient.settings.after': 'Запускать через',
  'ambient.settings.after-hint': 'Если столько времени ничего не нажимать, Orbit переходит в неспешное слайд-шоу из обложек. Никогда — во время воспроизведения.',
  'ambient.settings.source': 'Что показывать',
  'ambient.settings.source-hint': 'То, что вы смотрите и сохранили, популярное или и то и другое по очереди.',
  'ambient.settings.source-for-you': 'Для вас',
  'ambient.settings.source-trending': 'В тренде',
  'ambient.settings.source-both': 'И то и другое',
  'ambient.settings.clock': 'Показывать часы',
  'ambient.settings.clock-hint': 'Время и дата в углу.',
  'ambient.settings.paused': 'Также на паузе',
  'ambient.settings.paused-hint': 'Запускается поверх плеера, если он столько времени стоит на паузе. Воспроизведение остаётся точно таким же.',
  'ambient.settings.preview': 'Предпросмотр',
  'ambient.settings.preview-label': 'Посмотреть сейчас',
  'ambient.settings.preview-hint': 'Сразу запускает фоновый режим. Нажмите любую клавишу или двиньте мышью, чтобы вернуться.',
};
