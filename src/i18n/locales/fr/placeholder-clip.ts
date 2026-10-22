import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** French strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Cette source a envoyé un court clip d’attente, pas la vidéo : le service debrid ne l’a pas encore téléchargée. Essayez une autre source, ou réessayez plus tard.",
};
