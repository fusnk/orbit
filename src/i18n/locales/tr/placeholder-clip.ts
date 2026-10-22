import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Turkish strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Bu kaynak videoyu değil, kısa bir yer tutucu klip gönderdi: debrid hizmeti onu henüz indirmedi. Başka bir kaynak dene ya da daha sonra yeniden dene.",
};
