import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** French strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Cette chaîne pointe vers une adresse de votre propre réseau, ce qu’une playlist de fournisseur n’a pas le droit de faire.",
};
