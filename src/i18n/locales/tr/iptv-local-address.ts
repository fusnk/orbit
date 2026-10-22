import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Turkish strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "Bu kanal kendi ağındaki bir adresi gösteriyor; bir sağlayıcının oynatma listesinin buna izni yok.",
};
