import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Russian text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Открыто по ссылке установки с веб-сайта. Проверьте аддон ниже, прежде чем устанавливать его.',
  'deeplink.unusable': 'Orbit не может использовать эту ссылку. Здесь открываются только ссылки установки аддонов (оканчивающиеся на manifest.json).',
  'deeplink.after-video': 'Получена ссылка установки аддона. Orbit откроет её, когда видео закончится.',
  'deeplink.home-network': 'В вашей домашней сети',
  'deeplink.home-network-note': 'Эта ссылка ведёт на этот компьютер или на устройство в вашей домашней сети. Orbit к нему ещё не обращался. Продолжайте, только если ожидаете найти там аддон.',
  'deeplink.continue': 'Продолжить',
};
