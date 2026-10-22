import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Ukrainian strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Це джерело надіслало короткий ролик-заглушку, а не відео: сервіс debrid ще його не завантажив. Спробуйте інше джерело або повторіть спробу пізніше.",
};
