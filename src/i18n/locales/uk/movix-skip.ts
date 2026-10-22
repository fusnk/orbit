import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Час пропуску аніме з AniSkip",
  'movix.aniskip-hint': "Для аніме також питає AniSkip — безплатну базу спільноти — де опенінги, ендінги й переказ. Надсилає лише ID серіалу на MyAnimeList і номер серії; щоб розпізнати серіал, може завантажити відкритий список ID з GitHub. Вимкнено, доки ви не ввімкнете.",
  'movix.smooth': "Плавний пропуск",
  'movix.smooth-hint': "Під час пропуску зображення на мить згасає до чорного, а звук стихає, потім обидва повертаються. З увімкненим «Менше руху» пропуск лишається миттєвим.",
  'movix.button-delay': "Показувати кнопку «Пропустити» через",
  'movix.button-delay-hint': "Дає початися заставці чи титрам, перш ніж з’явиться «Пропустити», щоб кнопка не закривала кінець сцени. Автоматичний пропуск не чекає.",
  'movix.button-delay-none': "Одразу",
  'movix.landing': "Зупинятися до кінця",
  'movix.landing-hint': "Пропуск закінчується трохи раніше кінця заставки чи переказу, щоб не обрізати першу мить після них. Якщо титри тривають до самого кінця, пропуск, як і раніше, веде в кінець.",
  'movix.landing-none': "У кінці",
  'movix.color-intro': "Колір заставки",
  'movix.color-recap': "Колір переказу",
  'movix.color-credits': "Колір титрів",
  'movix.color-preview': "Колір анонсу",
  'movix.colors-hint': "Як кожна частина виглядає на шкалі часу.",
  'movix.swatch.default': "Стандартний",
  'movix.swatch.amber': "Бурштиновий",
  'movix.swatch.sky': "Небесно-блакитний",
  'movix.swatch.mint': "М’ятний",
  'movix.swatch.rose': "Рожевий",
  'movix.swatch.violet': "Фіолетовий",
  'movix.swatch.white': "Білий",
};
