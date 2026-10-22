import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Chinese strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "此频道指向你自己网络中的地址，服务商的播放列表不允许这样做。",
};
