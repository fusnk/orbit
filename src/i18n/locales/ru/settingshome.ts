import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // One line under each category's title
  'settingshome.intro.general': 'Язык, запуск и закрытие Orbit, удобство, оповещения и резервные копии.',
  'settingshome.intro.addons': 'Откуда берутся каталоги и потоки и как Orbit выбирает источник.',
  'settingshome.intro.downloads': 'Что Orbit хранит на этом компьютере для просмотра офлайн.',
  'settingshome.intro.shortcuts': 'Все клавиши, на которые реагирует Orbit, и что они делают.',
  'settingshome.intro.home-library': 'Строки Главной, «Продолжить просмотр» и спойлеры.',
  'settingshome.intro.subtitles': 'Язык субтитров и их внешний вид.',
  'settingshome.intro.picture-sound': 'Изображение, оборудование, которое с ним работает, и вывод звука.',
  'settingshome.intro.accounts': 'Аккаунты и сервисы, с которыми работает Orbit, и ваши источники прямого эфира.',
  // Search settings (opens the command palette on Settings)
  'settingshome.search.button': 'Поиск настроек',
  'settingshome.search.placeholder': 'Поиск настроек',
  'settingshome.search.none': 'Подходящих настроек нет.',
  // The profile header's service lines
  'settingshome.connections': 'Подключённые сервисы',
  'settingshome.stremio.signed-in': 'Stremio · вход выполнен',
  'settingshome.stremio.synced': 'Stremio · синхронизировано {when}',
  'settingshome.stremio.synced-now': 'Stremio · синхронизировано только что',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // The save line
  'settingshome.saved': 'Сохранено',
  'settingshome.saved-announce': 'Настройка сохранена',
  // Settings → General → About Orbit
  'settingshome.about.heading': 'Об Orbit',
  'settingshome.about.version': 'Версия {version}',
  'settingshome.about.made-by': 'Автор: {name}',
  'settingshome.about.licence': 'Свободное ПО · {licence}',
  'settingshome.about.source': 'Исходный код',
  'settingshome.about.licences': 'Лицензии открытого ПО',
  'settingshome.about.legal-heading': 'Правовая информация',
  'settingshome.about.legal-independent': 'Orbit — независимое приложение с открытым исходным кодом. Оно не связано со Stremio, авторами аддонов, сервисами и компаниями, упомянутыми в приложении, и не одобрено и не спонсируется ими. {names} и все прочие названия и логотипы принадлежат их владельцам и указаны лишь для того, чтобы показать, с чем работает Orbit.',
  'settingshome.about.legal-content': 'Orbit не размещает, не распространяет и не индексирует никакие медиафайлы. Всё, что вы смотрите, поступает из аддонов, сервисов или серверов, которые вы настроили сами, и вы сами отвечаете за то, что смотрите, и за соблюдение законов своей страны.',
  // Settings → General → About Orbit: updates, and the banner when one is ready
  'settingshome.updates.label': 'Обновления',
  'settingshome.updates.check': 'Проверить обновления',
  'settingshome.updates.idle': 'Orbit проверяет обновления раз в день и спрашивает перед установкой.',
  'settingshome.updates.idle-manual': 'Orbit проверяет обновления только по вашему запросу и спрашивает перед установкой.',
  'settingshome.updates.idle-auto': 'Orbit проверяет обновления раз в день и устанавливает их при выходе.',
  'settingshome.updates.idle-manual-auto': 'Orbit проверяет обновления только по вашему запросу и устанавливает их при выходе.',
  'settingshome.updates.checking': 'Проверка обновлений…',
  'settingshome.updates.up-to-date': 'У вас последняя версия Orbit.',
  'settingshome.updates.downloading': 'Загрузка Orbit {version}…',
  'settingshome.updates.failed': 'Не удалось проверить обновления. Повторите попытку позже.',
  'settingshome.updates.download-failed': 'Не удалось скачать Orbit {version}. Orbit попробует ещё раз позже.',
  'settingshome.updates.off': 'В этой сборке обновления отключены.',
  'settingshome.updates.ready': 'Orbit {version} готов к установке',
  'settingshome.updates.restart': 'Перезапустить и обновить',
  'settingshome.updates.later': 'Позже',
  'settingshome.updates.install-failed': 'Не удалось установить обновление. Повторите попытку позже.',
  'settingshome.updates.auto': 'Обновлять автоматически',
  'settingshome.updates.auto-hint': 'Загруженное обновление устанавливается при выходе из Orbit. Если выключено, Orbit только сообщит о нём.',
  'settingshome.updates.check-auto': 'Проверять обновления автоматически',
  'settingshome.updates.check-auto-hint': 'Ищет новую версию раз в день. Если выключено, Orbit проверяет только по кнопке «Проверить обновления».',
  // Shown once after an update
  'settingshome.whats-new.heading': 'Что нового в Orbit {version}',
  'settingshome.whats-new.plain': 'Orbit обновлён до версии {version}.',
  'settingshome.whats-new.close': 'Понятно',
};
