import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Медленнее',
  'pstream.keys.speed-up': 'Быстрее',
  'pstream.keys.seek-back-small': 'Назад на 1 секунду (на паузе — на кадр)',
  'pstream.keys.seek-forward-small': 'Вперёд на 1 секунду (на паузе — на кадр)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Закончится в {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Вернуться к {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Фрагменты, которые можно пропустить',
  'pstream.chapters.to-end': '{from} – конец',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Отметить {episode} как просмотренную',
  'pstream.episodes.mark-unwatched': 'Отметить {episode} как непросмотренную',
  'pstream.episodes.watched': 'Просмотрено',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'Для слабослышащих',
  'pstream.subs.match-good': 'Хорошее совпадение',
  'pstream.subs.match-fair': 'Среднее совпадение',
  'pstream.subs.match-poor': 'Плохое совпадение',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, в секундах',
  'pstream.timing.type': '{name}: {value}. Активируйте, чтобы ввести значение',
  'pstream.timing.invalid': 'Введите секунды, например 1.5 или -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Тайминг сброшен для новых субтитров',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Стиль субтитров',
  'pstream.style.position': 'Положение',
  'pstream.style.custom': 'Свой…',
  'pstream.style.hex': 'Код цвета, например #ffcc00',
  'pstream.style.caps-note': 'Применяется к субтитрам, добавленным после изменения.',
  'pstream.style.more': 'Непрозрачность текста, цвет и непрозрачность подложки и цвет обводки — в Настройки → Субтитры.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Повторить',
  'pstream.error.retry-at': 'Повторить с {time}',
  'pstream.error.copy': 'Скопировать подробности',
  'pstream.error.copied': 'Подробности скопированы. Адреса и ключи не включены.',
  'pstream.error.copy-failed': 'Не удалось скопировать подробности',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Двойной щелчок по краям для перемотки',
  'pstream.settings.double-click-hint': 'Двойной щелчок по левой или правой трети изображения перематывает назад или вперёд на шаг перемотки. Двойной щелчок посередине по-прежнему переключает полный экран.',
};
