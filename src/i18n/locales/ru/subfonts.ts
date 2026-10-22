import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': 'Предпросмотр',
  'subfonts.preview-hint': 'Так плеер покажет ваши субтитры. Размер и обводка близки к настоящим, но могут немного отличаться.',
  'subfonts.fullscreen': 'Предпросмотр на весь экран',
  'subfonts.fullscreen-close': 'Нажмите Esc или щёлкните, чтобы закрыть',
  'subfonts.line1': 'Никогда не думал, что мы зайдём так далеко.',
  'subfonts.line2': 'Я тоже. Идём дальше.',
  'subfonts.font': 'Шрифт',
  'subfonts.font-label': 'Шрифт субтитров',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend и OpenDyslexic созданы для удобного чтения и входят в Orbit. Стилизованные субтитры сохраняют свой шрифт.',
  'subfonts.default': 'По умолчанию',
};
