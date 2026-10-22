import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Ukrainian text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Відкрито за посиланням встановлення з вебсайту. Перевірте аддон нижче, перш ніж установлювати його.',
  'deeplink.unusable': 'Orbit не може використати це посилання. Тут відкриваються лише посилання встановлення аддонів (що закінчуються на manifest.json).',
  'deeplink.after-video': 'Отримано посилання встановлення аддона. Orbit відкриє його, коли відео закінчиться.',
  'deeplink.home-network': 'У вашій домашній мережі',
  'deeplink.home-network-note': 'Це посилання веде на цей комп’ютер або на пристрій у вашій домашній мережі. Orbit ще не звертався до нього. Продовжуйте, лише якщо очікуєте там аддон.',
  'deeplink.continue': 'Продовжити',
};
