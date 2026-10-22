import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': 'Смотрите со своего сервера Jellyfin. У фильмов и серий, которые на нём есть, появится источник Jellyfin, а его строки можно добавить на Главную. Orbit хранит токен входа от сервера, но никогда не хранит ваш пароль.',
  'jellyfin.settings.server': 'Адрес сервера',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Имя пользователя',
  'jellyfin.settings.password': 'Пароль',
  'jellyfin.settings.fields-hint': 'Адрес, по которому вы открываете Jellyfin в браузере. Нужен Jellyfin 10.9 или новее.',
  'jellyfin.settings.connect': 'Подключить',
  'jellyfin.settings.connecting': 'Подключение…',
  'jellyfin.settings.server-label': 'Сервер',
  'jellyfin.settings.connected-as': 'Подключено как {user} на {server}',
  'jellyfin.settings.connected': 'Подключено к {server}.',
  'jellyfin.settings.connected-first': 'Подключено к {server}. Строка «Недавно добавленные» уже на Главной; другие строки Jellyfin можно добавить в Настройки → Главная и библиотека → Строки Главной.',
  'jellyfin.settings.disconnect': 'Отключить',
  'jellyfin.settings.disconnected': 'Отключено, выход с сервера выполнен.',
  'jellyfin.settings.insecure': 'Не защищено',
  'jellyfin.settings.insecure-title': 'Этот сервер использует обычный http, поэтому данные входа и видео передаются без шифрования. Дома это допустимо; через интернет используйте https.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Продолжить просмотр',
  'jellyfin.rows.latest': 'Недавно добавленные',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Сначала подключите сервер Jellyfin в Настройки → Аккаунты и сервисы.',
  'jellyfin.rows.libraries-failed': 'Не удалось загрузить медиатеки сервера.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
