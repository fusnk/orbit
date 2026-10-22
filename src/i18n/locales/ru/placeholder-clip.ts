import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Russian strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Этот источник прислал короткий ролик-заглушку, а не видео: сервис debrid его ещё не скачал. Попробуйте другой источник или повторите попытку позже.",
};
