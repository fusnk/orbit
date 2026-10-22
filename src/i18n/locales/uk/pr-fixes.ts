import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Ukrainian strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Оновити налаштування цього аддона?",
  'prfixes.addons.update-detail': "{name} вже встановлено. Ці налаштування замінять попередні, а аддон збереже своє місце у списку.",
  'prfixes.addons.update': "Оновити",
  'prfixes.audio.original': "Спочатку мова оригіналу",
  'prfixes.audio.original-hint': "Кожен фільм чи серіал починається мовою оригіналу, якщо у відео є така доріжка: аніме японською, корейська дорама корейською. Інакше — мова аудіо вище. Потрібен ключ TMDB.",
  'prfixes.bundle.local': "Ця адреса веде на цей комп’ютер або у вашу домашню мережу, тому Orbit до неї не звертався.",
};
