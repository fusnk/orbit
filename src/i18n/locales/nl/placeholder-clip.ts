import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Dutch strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Deze bron stuurde een korte placeholderclip, niet de video: de debriddienst heeft hem nog niet gedownload. Probeer een andere bron, of probeer het later opnieuw.",
};
