import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** German strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Dieser Sender verweist auf eine Adresse in deinem eigenen Netzwerk. Das darf die Playlist eines Anbieters nicht.",
};
