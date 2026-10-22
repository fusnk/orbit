import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Italian strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Questo canale punta a un indirizzo della tua rete, cosa che la playlist di un provider non può fare.",
};
