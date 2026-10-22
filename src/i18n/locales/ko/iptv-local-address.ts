import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Korean strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "이 채널은 내 네트워크 안의 주소를 가리켜요. 제공업체의 재생 목록은 그렇게 할 수 없어요.",
};
