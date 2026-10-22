import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': 'Налаштування',
  'playerplus.hub.back': 'Назад: {to}',
  'playerplus.hub.picture': 'Якість і зображення',
  'playerplus.hub.sound': 'Звук',
  'playerplus.hub.speed-note': 'Утримуйте {key}, щоб дивитися зі швидкістю 2×, доки тримаєте клавішу.',
  'playerplus.hub.no-audio': 'Звукових доріжок поки немає. Вони з’являться, коли відео завантажиться.',
  'playerplus.hub.timing-sub': 'Субтитри {delay}',
  'playerplus.hub.timing-audio': 'Звук {delay}',
  'playerplus.hub.timing-none': 'Без зсуву',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': 'Спершу чую',
  'playerplus.timing.heard-first-hint': 'Субтитри запізнюються: показувати раніше',
  'playerplus.timing.saw-first': 'Спершу бачу',
  'playerplus.timing.saw-first-hint': 'Субтитри поспішають: показувати пізніше',
  'playerplus.timing.earlier-by': 'Показувати субтитри на {value} с раніше',
  'playerplus.timing.later-by': 'Показувати субтитри на {value} с пізніше',

  // Sound
  'playerplus.sound.off': 'Оригінал',
  'playerplus.sound.off-hint': 'Звук у початковому зведенні.',
  'playerplus.sound.cinema': 'Кіно',
  'playerplus.sound.cinema-hint': 'Щільніші низи й трохи більше повітря — для фільмів на добрій гучності.',
  'playerplus.sound.music': 'Музика',
  'playerplus.sound.music-hint': 'Теплі баси й яскраві верхи — для концертів і мюзиклів.',
  'playerplus.sound.dialogue': 'Чіткі діалоги',
  'playerplus.sound.dialogue-hint': 'Голоси виводяться на передній план поверх музики й ефектів.',
  'playerplus.sound.note': 'Можна вибрати один режим. Запам’ятовується для всіх відео.',

  // Live source search
  'playerplus.search.label': 'Пошук джерела для «{name}»',
  'playerplus.search.finding': 'Пошук аддонів…',
  'playerplus.search.asking': 'Запит…',
  'playerplus.search.sources.one': '{count} джерело',
  'playerplus.search.sources.few': '{count} джерела',
  'playerplus.search.sources.many': '{count} джерел',
  'playerplus.search.sources.other': '{count} джерела',
  'playerplus.search.none': 'Немає результатів',
  'playerplus.search.failed': 'Не відповів',
  'playerplus.search.progress.one': 'Відповів {count} з {total} аддонів · знайдено джерел: {found}',
  'playerplus.search.progress.few': 'Відповіли {count} з {total} аддонів · знайдено джерел: {found}',
  'playerplus.search.progress.many': 'Відповіли {count} з {total} аддонів · знайдено джерел: {found}',
  'playerplus.search.progress.other': 'Відповіли {count} з {total} аддонів · знайдено джерел: {found}',

  // Time readout
  'playerplus.time.finish': 'Залишилося {left} · Закінчиться о {time}',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'Заставка',
  'playerplus.bands.recap': 'Переказ',
  'playerplus.bands.credits': 'Титри',
  'playerplus.bands.preview': 'Анонс',

  // Skipping
  'playerplus.skip.preview': 'Пропустити анонс',
  'playerplus.skip.skipped-credits': 'Титри пропущено',
  'playerplus.skip.skipped-preview': 'Анонс пропущено',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds} с',
  'playerplus.bubble.back': '−{seconds} с',

  // Shortcut list
  'playerplus.cheat.action': 'Показати клавіші плеєра',
  'playerplus.cheat.title': 'Клавіші плеєра',
  'playerplus.cheat.playback': 'Відтворення',
  'playerplus.cheat.sound': 'Звук і субтитри',
  'playerplus.cheat.window': 'Зображення й вікно',
  'playerplus.cheat.fixed': 'Завжди',
  'playerplus.cheat.no-key': 'Немає клавіші',
  'playerplus.cheat.hold': 'Утримувати {key}',
  'playerplus.keys.number-jump': 'Перейти до 0–90% відео',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'Швидкість 2× під час утримання',
  'playerplus.keys.hold-boost-keys': 'Утримувати {key}',

  // Lock
  'playerplus.lock.action': 'Заблокувати керування',
  'playerplus.lock.unlock': 'Розблокувати',
  'playerplus.lock.hint': 'Керування заблоковано. Натисніть Esc тричі, щоб розблокувати.',
  'playerplus.lock.hint-key': 'Керування заблоковано. Натисніть {key} або тричі Esc, щоб розблокувати.',
  'playerplus.lock.unlocked': 'Керування розблоковано',

  // Docked episodes
  'playerplus.dock.collapse': 'Приховати серії',
  'playerplus.dock.expand': 'Показати серії',
  'playerplus.dock.number': 'E{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': 'Утримання для швидкості 2×',
  'playerplus.settings.hold-boost-hint': 'Доки ви утримуєте клавішу відтворення/паузи, відео йде з подвійною швидкістю. Коротке натискання, як і раніше, ставить на паузу.',
  'playerplus.settings.number-jump': 'Перехід цифровими клавішами',
  'playerplus.settings.number-jump-hint': '1 переходить до 10% відео, 5 — до середини, 0 — до початку. Клавіші, яким ви призначили іншу дію, зберігають її.',
  'playerplus.settings.grayscale': 'Чорно-біле зображення на паузі',
  'playerplus.settings.grayscale-hint': 'На паузі картинка стає сірою, колір повертається під час відтворення.',
  'playerplus.settings.episodes': 'Список серій',
  'playerplus.settings.episodes-hint': '«Плаваючий» відкривається поверх елементів керування. «Закріплений» тримає список праворуч, який згортається в невелику вкладку.',
  'playerplus.settings.episodes-floating': 'Плаваючий',
  'playerplus.settings.episodes-docked': 'Закріплений',
  'playerplus.settings.skipping': 'Пропуск',
  'playerplus.settings.skipping-hint': '«Кнопка» показує «Пропустити», поки йде фрагмент; «Автоматично» пропускає його без запитань (один раз: перемотайте назад, щоб подивитися).',
  'playerplus.settings.skip-intro': 'Заставки',
  'playerplus.settings.skip-recap': 'Перекази',
  'playerplus.settings.skip-credits': 'Фінальні титри',
  'playerplus.settings.skip-preview': 'Анонси після титрів',
  'playerplus.settings.skip-off': 'Вимк.',
  'playerplus.settings.skip-button': 'Кнопка',
  'playerplus.settings.skip-auto': 'Автоматично',
  'playerplus.settings.learn-skips': 'Запам’ятовувати, де я пропускаю заставку',
  'playerplus.settings.learn-skips-hint': 'Пропустіть заставку вручну в одній серії, і в наступних серіях з’явиться «Пропустити заставку» в той самий час, якщо інші дані про пропуски невідомі. Зберігається на цьому пристрої для цього профілю.',
  'playerplus.settings.forget-skips': 'Запам’ятовані заставки',
  'playerplus.settings.forget-skips-hint': 'Забуває час заставок, запам’ятований для всіх серіалів у цьому профілі.',
  'playerplus.settings.forget-skips-action': 'Забути',
  'playerplus.settings.forget-skips-done': 'Запам’ятований час заставок забуто',
};
