import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Время пропуска аниме из AniSkip",
  'movix.aniskip-hint': "Для аниме также спрашивает AniSkip — бесплатную базу сообщества — где опенинги, эндинги и пересказы. Отправляет только ID сериала на MyAnimeList и номер серии; чтобы узнать сериал, может скачать открытый список ID с GitHub. Выключено, пока вы не включите.",
  'movix.smooth': "Плавный пропуск",
  'movix.smooth-hint': "При пропуске изображение на мгновение уходит в чёрное, а звук стихает, затем оба возвращаются. При включённом «Меньше движения» пропуск остаётся мгновенным.",
  'movix.button-delay': "Показывать кнопку «Пропустить» через",
  'movix.button-delay-hint': "Даёт начаться заставке или титрам, прежде чем появится «Пропустить», чтобы кнопка не закрывала конец сцены. Автоматический пропуск не ждёт.",
  'movix.button-delay-none': "Сразу",
  'movix.landing': "Останавливаться до конца",
  'movix.landing-hint': "Пропуск заканчивается немного раньше конца заставки или пересказа, чтобы не обрезать первый момент после них. Титры до самого конца по-прежнему ведут в конец.",
  'movix.landing-none': "В конце",
  'movix.color-intro': "Цвет заставки",
  'movix.color-recap': "Цвет пересказа",
  'movix.color-credits': "Цвет титров",
  'movix.color-preview': "Цвет анонса",
  'movix.colors-hint': "Как каждая часть выглядит на шкале времени.",
  'movix.swatch.default': "Стандартный",
  'movix.swatch.amber': "Янтарный",
  'movix.swatch.sky': "Небесно-голубой",
  'movix.swatch.mint': "Мятный",
  'movix.swatch.rose': "Розовый",
  'movix.swatch.violet': "Фиолетовый",
  'movix.swatch.white': "Белый",
};
