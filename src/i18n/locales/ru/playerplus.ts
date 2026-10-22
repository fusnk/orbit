import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': 'Настройки',
  'playerplus.hub.back': 'Назад: {to}',
  'playerplus.hub.picture': 'Качество и изображение',
  'playerplus.hub.sound': 'Звук',
  'playerplus.hub.speed-note': 'Удерживайте {key}, чтобы смотреть на скорости 2×, пока держите клавишу.',
  'playerplus.hub.no-audio': 'Звуковых дорожек пока нет. Они появятся, когда видео загрузится.',
  'playerplus.hub.timing-sub': 'Субтитры {delay}',
  'playerplus.hub.timing-audio': 'Звук {delay}',
  'playerplus.hub.timing-none': 'Без сдвига',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': 'Сначала слышу',
  'playerplus.timing.heard-first-hint': 'Субтитры опаздывают: показывать раньше',
  'playerplus.timing.saw-first': 'Сначала вижу',
  'playerplus.timing.saw-first-hint': 'Субтитры спешат: показывать позже',
  'playerplus.timing.earlier-by': 'Показывать субтитры на {value} с раньше',
  'playerplus.timing.later-by': 'Показывать субтитры на {value} с позже',

  // Sound
  'playerplus.sound.off': 'Оригинал',
  'playerplus.sound.off-hint': 'Звук в исходном сведении.',
  'playerplus.sound.cinema': 'Кино',
  'playerplus.sound.cinema-hint': 'Плотнее низы и чуть больше воздуха — для фильмов на хорошей громкости.',
  'playerplus.sound.music': 'Музыка',
  'playerplus.sound.music-hint': 'Тёплые басы и яркие верха — для концертов и мюзиклов.',
  'playerplus.sound.dialogue': 'Чёткие диалоги',
  'playerplus.sound.dialogue-hint': 'Голоса выводятся на передний план поверх музыки и эффектов.',
  'playerplus.sound.note': 'Можно выбрать один режим. Запоминается для всех видео.',

  // Live source search
  'playerplus.search.label': 'Поиск источника для «{name}»',
  'playerplus.search.finding': 'Поиск аддонов…',
  'playerplus.search.asking': 'Запрос…',
  'playerplus.search.sources.one': '{count} источник',
  'playerplus.search.sources.few': '{count} источника',
  'playerplus.search.sources.many': '{count} источников',
  'playerplus.search.sources.other': '{count} источника',
  'playerplus.search.none': 'Нет результатов',
  'playerplus.search.failed': 'Не ответил',
  'playerplus.search.progress.one': 'Ответил {count} из {total} аддонов · найдено источников: {found}',
  'playerplus.search.progress.few': 'Ответили {count} из {total} аддонов · найдено источников: {found}',
  'playerplus.search.progress.many': 'Ответили {count} из {total} аддонов · найдено источников: {found}',
  'playerplus.search.progress.other': 'Ответили {count} из {total} аддонов · найдено источников: {found}',

  // Time readout
  'playerplus.time.finish': 'Осталось {left} · Закончится в {time}',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'Заставка',
  'playerplus.bands.recap': 'Пересказ',
  'playerplus.bands.credits': 'Титры',
  'playerplus.bands.preview': 'Анонс',

  // Skipping
  'playerplus.skip.preview': 'Пропустить анонс',
  'playerplus.skip.skipped-credits': 'Титры пропущены',
  'playerplus.skip.skipped-preview': 'Анонс пропущен',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds} с',
  'playerplus.bubble.back': '−{seconds} с',

  // Shortcut list
  'playerplus.cheat.action': 'Показать клавиши плеера',
  'playerplus.cheat.title': 'Клавиши плеера',
  'playerplus.cheat.playback': 'Воспроизведение',
  'playerplus.cheat.sound': 'Звук и субтитры',
  'playerplus.cheat.window': 'Изображение и окно',
  'playerplus.cheat.fixed': 'Всегда',
  'playerplus.cheat.no-key': 'Нет клавиши',
  'playerplus.cheat.hold': 'Удерживать {key}',
  'playerplus.keys.number-jump': 'Перейти к 0–90% видео',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'Скорость 2× при удержании',
  'playerplus.keys.hold-boost-keys': 'Удерживать {key}',

  // Lock
  'playerplus.lock.action': 'Заблокировать управление',
  'playerplus.lock.unlock': 'Разблокировать',
  'playerplus.lock.hint': 'Управление заблокировано. Нажмите Esc три раза, чтобы разблокировать.',
  'playerplus.lock.hint-key': 'Управление заблокировано. Нажмите {key} или трижды Esc, чтобы разблокировать.',
  'playerplus.lock.unlocked': 'Управление разблокировано',

  // Docked episodes
  'playerplus.dock.collapse': 'Скрыть серии',
  'playerplus.dock.expand': 'Показать серии',
  'playerplus.dock.number': 'E{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': 'Удержание для скорости 2×',
  'playerplus.settings.hold-boost-hint': 'Пока вы удерживаете клавишу воспроизведения/паузы, видео идёт на двойной скорости. Короткое нажатие по-прежнему ставит на паузу.',
  'playerplus.settings.number-jump': 'Переход цифровыми клавишами',
  'playerplus.settings.number-jump-hint': '1 переходит к 10% видео, 5 — к середине, 0 — к началу. Клавиши, которым вы назначили другое действие, сохраняют его.',
  'playerplus.settings.grayscale': 'Чёрно-белое изображение на паузе',
  'playerplus.settings.grayscale-hint': 'На паузе картинка становится серой, цвет возвращается при воспроизведении.',
  'playerplus.settings.episodes': 'Список серий',
  'playerplus.settings.episodes-hint': '«Плавающий» открывается поверх элементов управления. «Закреплённый» держит список справа, который сворачивается в небольшую вкладку.',
  'playerplus.settings.episodes-floating': 'Плавающий',
  'playerplus.settings.episodes-docked': 'Закреплённый',
  'playerplus.settings.skipping': 'Пропуск',
  'playerplus.settings.skipping-hint': '«Кнопка» показывает «Пропустить», пока идёт фрагмент; «Автоматически» пропускает его без вопросов (один раз: перемотайте назад, чтобы посмотреть).',
  'playerplus.settings.skip-intro': 'Заставки',
  'playerplus.settings.skip-recap': 'Пересказы',
  'playerplus.settings.skip-credits': 'Финальные титры',
  'playerplus.settings.skip-preview': 'Анонсы после титров',
  'playerplus.settings.skip-off': 'Выкл.',
  'playerplus.settings.skip-button': 'Кнопка',
  'playerplus.settings.skip-auto': 'Автоматически',
  'playerplus.settings.learn-skips': 'Запоминать, где я пропускаю заставку',
  'playerplus.settings.learn-skips-hint': 'Пропустите заставку вручную в одной серии, и в следующих сериях появится «Пропустить заставку» в то же время, если другие данные о пропусках неизвестны. Хранится на этом устройстве для этого профиля.',
  'playerplus.settings.forget-skips': 'Запомненные заставки',
  'playerplus.settings.forget-skips-hint': 'Забывает время заставок, запомненное для всех сериалов в этом профиле.',
  'playerplus.settings.forget-skips-action': 'Забыть',
  'playerplus.settings.forget-skips-done': 'Запомненное время заставок забыто',
};
