import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Settings → Appearance → Title page.
  'showcase.setting.label': 'Сторінка фільму',
  'showcase.setting.hint': '«Класична» тримає обкладинку в картці. «Вітрина» розтягує її на все вікно, а подробиці — у розділах нижче.',
  'showcase.setting.classic': 'Класична',
  'showcase.setting.showcase': 'Вітрина',
  // The hero.
  'showcase.start-episode': 'Почати S{season} · E{episode}',
  'showcase.ends-at': 'Закінчиться о {time}',
  'showcase.ends-at-hint': 'Коли закінчиться, якщо почати зараз',
  'showcase.age-rating': 'Рейтинг {rating}',
  'showcase.streaming-on': 'Дивитися на {provider}',
  // Episodes.
  'showcase.choose-season': 'Сезон',
  'showcase.choose-arc': 'Сюжетна арка',
  'showcase.episode-count.one': '{count} серія',
  'showcase.episode-count.few': '{count} серії',
  'showcase.episode-count.many': '{count} серій',
  'showcase.episode-count.other': '{count} серії',
  'showcase.episode-length': '{number} · {minutes} хв',
  'showcase.season-actions': 'Дії із сезоном',
  'showcase.download-season.one': 'Завантажити сезон ({count} серія)',
  'showcase.download-season.few': 'Завантажити сезон ({count} серії)',
  'showcase.download-season.many': 'Завантажити сезон ({count} серій)',
  'showcase.download-season.other': 'Завантажити сезон ({count} серії)',
  // Sections.
  'showcase.extras': 'Трейлери й додатково',
  'showcase.cast-crew': 'Актори та знімальна група',
  'showcase.photos': 'Фото',
  'showcase.stills': 'Кадри',
  'showcase.topics': 'Теми',
  'showcase.topic-intro': 'Фільми й серіали з міткою TMDB «{topic}».',
  'showcase.where-to-watch': 'Де подивитися',
  'showcase.stream': 'Підписка',
  'showcase.rent': 'Оренда',
  'showcase.buy': 'Купівля',
  'showcase.justwatch': 'Дані JustWatch',
  'showcase.releases': 'Дати виходу',
  'showcase.cinemas-only': 'Поки лише в кінотеатрах — ранні копії зазвичай записані в залі.',
};
