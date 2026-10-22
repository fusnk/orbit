import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** German strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Diese Quelle hat nur einen kurzen Platzhalter-Clip geschickt, nicht das Video: Der Debrid-Dienst hat es noch nicht heruntergeladen. Versuche eine andere Quelle oder versuche es später noch einmal.",
};
