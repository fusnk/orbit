import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Polish strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "To źródło wysłało krótki klip zastępczy, a nie wideo: usługa debrid jeszcze go nie pobrała. Wypróbuj inne źródło albo spróbuj ponownie później.",
};
