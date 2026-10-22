import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Dutch strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Deze zender verwijst naar een adres in je eigen netwerk, en dat mag de playlist van een aanbieder niet.",
};
