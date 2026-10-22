import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // One line under each category's title
  'settingshome.intro.general': 'Мова, запуск і закриття Orbit, зручність, сповіщення та резервні копії.',
  'settingshome.intro.addons': 'Звідки беруться каталоги й потоки та як Orbit вибирає джерело.',
  'settingshome.intro.downloads': 'Що Orbit зберігає на цьому комп’ютері для перегляду офлайн.',
  'settingshome.intro.shortcuts': 'Усі клавіші, на які реагує Orbit, і що вони роблять.',
  'settingshome.intro.home-library': 'Рядки Головної, «Продовжити перегляд» і спойлери.',
  'settingshome.intro.subtitles': 'Мова субтитрів та їхній вигляд.',
  'settingshome.intro.picture-sound': 'Зображення, обладнання, яке з ним працює, і виведення звуку.',
  'settingshome.intro.accounts': 'Облікові записи й сервіси, з якими працює Orbit, і ваші джерела прямого ефіру.',
  // Search settings (opens the command palette on Settings)
  'settingshome.search.button': 'Пошук налаштувань',
  'settingshome.search.placeholder': 'Пошук налаштувань',
  'settingshome.search.none': 'Відповідних налаштувань немає.',
  // The profile header's service lines
  'settingshome.connections': 'Підключені сервіси',
  'settingshome.stremio.signed-in': 'Stremio · вхід виконано',
  'settingshome.stremio.synced': 'Stremio · синхронізовано {when}',
  'settingshome.stremio.synced-now': 'Stremio · синхронізовано щойно',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // The save line
  'settingshome.saved': 'Збережено',
  'settingshome.saved-announce': 'Налаштування збережено',
  // Settings → General → About Orbit
  'settingshome.about.heading': 'Про Orbit',
  'settingshome.about.version': 'Версія {version}',
  'settingshome.about.made-by': 'Автор: {name}',
  'settingshome.about.licence': 'Вільне ПЗ · {licence}',
  'settingshome.about.source': 'Вихідний код',
  'settingshome.about.licences': 'Ліцензії відкритого ПЗ',
  'settingshome.about.legal-heading': 'Правова інформація',
  'settingshome.about.legal-independent': 'Orbit — незалежний застосунок з відкритим кодом. Він не пов’язаний зі Stremio, авторами аддонів, сервісами й компаніями, згаданими в застосунку, і не схвалений та не спонсорований ними. {names} та всі інші назви й логотипи належать їхнім власникам і вказані лише для того, щоб показати, з чим працює Orbit.',
  'settingshome.about.legal-content': 'Orbit не розміщує, не поширює й не індексує жодних медіафайлів. Усе, що ви дивитеся, надходить з аддонів, сервісів або серверів, які ви налаштували самі, і ви самі відповідаєте за те, що дивитеся, та за дотримання законів своєї країни.',
  // Settings → General → About Orbit: updates, and the banner when one is ready
  'settingshome.updates.label': 'Оновлення',
  'settingshome.updates.check': 'Перевірити оновлення',
  'settingshome.updates.idle': 'Orbit перевіряє оновлення раз на день і запитує перед встановленням.',
  'settingshome.updates.idle-manual': 'Orbit перевіряє оновлення лише на ваш запит і запитує перед встановленням.',
  'settingshome.updates.idle-auto': 'Orbit перевіряє оновлення раз на день і встановлює їх під час виходу.',
  'settingshome.updates.idle-manual-auto': 'Orbit перевіряє оновлення лише на ваш запит і встановлює їх під час виходу.',
  'settingshome.updates.checking': 'Перевірка оновлень…',
  'settingshome.updates.up-to-date': 'У вас остання версія Orbit.',
  'settingshome.updates.downloading': 'Завантаження Orbit {version}…',
  'settingshome.updates.failed': 'Не вдалося перевірити оновлення. Спробуйте пізніше.',
  'settingshome.updates.download-failed': 'Не вдалося завантажити Orbit {version}. Orbit спробує ще раз пізніше.',
  'settingshome.updates.off': 'У цій збірці оновлення вимкнено.',
  'settingshome.updates.ready': 'Orbit {version} готовий до встановлення',
  'settingshome.updates.restart': 'Перезапустити й оновити',
  'settingshome.updates.later': 'Пізніше',
  'settingshome.updates.install-failed': 'Не вдалося встановити оновлення. Спробуйте пізніше.',
  'settingshome.updates.auto': 'Оновлювати автоматично',
  'settingshome.updates.auto-hint': 'Завантажене оновлення встановлюється під час виходу з Orbit. Якщо вимкнено, Orbit лише повідомить про нього.',
  'settingshome.updates.check-auto': 'Перевіряти оновлення автоматично',
  'settingshome.updates.check-auto-hint': 'Шукає нову версію раз на день. Якщо вимкнено, Orbit перевіряє лише за кнопкою «Перевірити оновлення».',
  // Shown once after an update
  'settingshome.whats-new.heading': 'Що нового в Orbit {version}',
  'settingshome.whats-new.plain': 'Orbit оновлено до версії {version}.',
  'settingshome.whats-new.close': 'Зрозуміло',
};
