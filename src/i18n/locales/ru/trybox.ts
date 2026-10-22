import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "Усиление громкости",
  'trybox.boost.note': "Ограничитель предотвращает искажение усиленного звука.",
  'trybox.boost.off': "Выключено",
  'trybox.boost.passthrough': "Отключите прямую передачу звука, чтобы усилить громкость.",
  'trybox.controls.title': "Размер элементов управления",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "Маленький",
  'trybox.controls.medium': "Средний",
  'trybox.controls.large': "Большой",
  'trybox.info.pin': "Показывать сведения о воспроизведении на экране",
  'trybox.info.dropped': "Пропущенные кадры",
  'trybox.info.fps': "Частота кадров",
  'trybox.hub.shortcuts': "Сочетания клавиш",
  'trybox.hub.controls': "Размер элементов управления",
  'trybox.hub.info': "Сведения на экране",
  'trybox.subtitle.sample': "Субтитры будут выглядеть так.",
  'trybox.subtitle.font': "Шрифт",
};
