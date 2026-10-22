import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': 'Дивіться зі свого сервера Jellyfin. У фільмів і серій, які на ньому є, з’явиться джерело Jellyfin, а його рядки можна додати на Головну. Orbit зберігає токен входу від сервера, але ніколи не зберігає ваш пароль.',
  'jellyfin.settings.server': 'Адреса сервера',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Ім’я користувача',
  'jellyfin.settings.password': 'Пароль',
  'jellyfin.settings.fields-hint': 'Адреса, за якою ви відкриваєте Jellyfin у браузері. Потрібен Jellyfin 10.9 або новіший.',
  'jellyfin.settings.connect': 'Підключити',
  'jellyfin.settings.connecting': 'Підключення…',
  'jellyfin.settings.server-label': 'Сервер',
  'jellyfin.settings.connected-as': 'Підключено як {user} на {server}',
  'jellyfin.settings.connected': 'Підключено до {server}.',
  'jellyfin.settings.connected-first': 'Підключено до {server}. Рядок «Нещодавно додані» вже на Головній; інші рядки Jellyfin можна додати в Налаштування → Головна й бібліотека → Рядки Головної.',
  'jellyfin.settings.disconnect': 'Відключити',
  'jellyfin.settings.disconnected': 'Відключено, вихід із сервера виконано.',
  'jellyfin.settings.insecure': 'Не захищено',
  'jellyfin.settings.insecure-title': 'Цей сервер використовує звичайний http, тому дані входу й відео передаються без шифрування. Удома це прийнятно; через інтернет використовуйте https.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Продовжити перегляд',
  'jellyfin.rows.latest': 'Нещодавно додані',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Спершу підключіть сервер Jellyfin у Налаштування → Облікові записи й сервіси.',
  'jellyfin.rows.libraries-failed': 'Не вдалося завантажити медіатеки сервера.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
