import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Japanese strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "このチャンネルはあなたのネットワーク内のアドレスを指しています。プロバイダーのプレイリストにはそれが許可されていません。",
};
