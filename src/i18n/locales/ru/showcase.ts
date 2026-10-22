import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Settings → Appearance → Title page.
  'showcase.setting.label': 'Страница фильма',
  'showcase.setting.hint': '«Классическая» держит обложку в карточке. «Витрина» растягивает её на всё окно, а подробности — в разделах ниже.',
  'showcase.setting.classic': 'Классическая',
  'showcase.setting.showcase': 'Витрина',
  // The hero.
  'showcase.start-episode': 'Начать S{season} · E{episode}',
  'showcase.ends-at': 'Закончится в {time}',
  'showcase.ends-at-hint': 'Когда закончится, если начать сейчас',
  'showcase.age-rating': 'Рейтинг {rating}',
  'showcase.streaming-on': 'Смотреть на {provider}',
  // Episodes.
  'showcase.choose-season': 'Сезон',
  'showcase.choose-arc': 'Сюжетная арка',
  'showcase.episode-count.one': '{count} серия',
  'showcase.episode-count.few': '{count} серии',
  'showcase.episode-count.many': '{count} серий',
  'showcase.episode-count.other': '{count} серии',
  'showcase.episode-length': '{number} · {minutes} мин',
  'showcase.season-actions': 'Действия с сезоном',
  'showcase.download-season.one': 'Скачать сезон ({count} серия)',
  'showcase.download-season.few': 'Скачать сезон ({count} серии)',
  'showcase.download-season.many': 'Скачать сезон ({count} серий)',
  'showcase.download-season.other': 'Скачать сезон ({count} серии)',
  // Sections.
  'showcase.extras': 'Трейлеры и дополнительно',
  'showcase.cast-crew': 'Актёры и съёмочная группа',
  'showcase.photos': 'Фото',
  'showcase.stills': 'Кадры',
  'showcase.topics': 'Темы',
  'showcase.topic-intro': 'Фильмы и сериалы с меткой TMDB «{topic}».',
  'showcase.where-to-watch': 'Где посмотреть',
  'showcase.stream': 'Подписка',
  'showcase.rent': 'Аренда',
  'showcase.buy': 'Покупка',
  'showcase.justwatch': 'Данные JustWatch',
  'showcase.releases': 'Даты выхода',
  'showcase.cinemas-only': 'Пока только в кинотеатрах — ранние копии обычно записаны в зале.',
};
