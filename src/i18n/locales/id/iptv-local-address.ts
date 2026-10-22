import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Indonesian strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Saluran ini mengarah ke alamat di jaringan Anda sendiri, yang tidak boleh dilakukan oleh playlist penyedia.",
};
