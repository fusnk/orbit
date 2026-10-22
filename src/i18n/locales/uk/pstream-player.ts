import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Повільніше',
  'pstream.keys.speed-up': 'Швидше',
  'pstream.keys.seek-back-small': 'Назад на 1 секунду (на паузі — на кадр)',
  'pstream.keys.seek-forward-small': 'Уперед на 1 секунду (на паузі — на кадр)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Закінчиться о {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Повернутися до {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Фрагменти, які можна пропустити',
  'pstream.chapters.to-end': '{from} – кінець',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Позначити {episode} як переглянуту',
  'pstream.episodes.mark-unwatched': 'Позначити {episode} як непереглянуту',
  'pstream.episodes.watched': 'Переглянуто',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'Для людей з порушеннями слуху',
  'pstream.subs.match-good': 'Добрий збіг',
  'pstream.subs.match-fair': 'Середній збіг',
  'pstream.subs.match-poor': 'Поганий збіг',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, у секундах',
  'pstream.timing.type': '{name}: {value}. Активуйте, щоб ввести значення',
  'pstream.timing.invalid': 'Введіть секунди, наприклад 1.5 або -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Таймінг скинуто для нових субтитрів',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Стиль субтитрів',
  'pstream.style.position': 'Положення',
  'pstream.style.custom': 'Власний…',
  'pstream.style.hex': 'Код кольору, наприклад #ffcc00',
  'pstream.style.caps-note': 'Застосовується до субтитрів, доданих після зміни.',
  'pstream.style.more': 'Непрозорість тексту, колір і непрозорість підкладки та колір обведення — у Налаштування → Субтитри.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Повторити',
  'pstream.error.retry-at': 'Повторити з {time}',
  'pstream.error.copy': 'Скопіювати подробиці',
  'pstream.error.copied': 'Подробиці скопійовано. Адреси й ключі не включено.',
  'pstream.error.copy-failed': 'Не вдалося скопіювати подробиці',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Подвійне клацання по краях для перемотування',
  'pstream.settings.double-click-hint': 'Подвійне клацання по лівій або правій третині зображення перемотує назад або вперед на крок перемотування. Подвійне клацання посередині, як і раніше, перемикає повний екран.',
};
