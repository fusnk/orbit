import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Italian strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Questa fonte ha inviato una breve clip segnaposto, non il video: il servizio debrid non l’ha ancora scaricato. Prova un’altra fonte o riprova più tardi.",
};
