import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Arabic strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "تشير هذه القناة إلى عنوان على شبكتك الخاصة، وهذا غير مسموح لقائمة تشغيل من مزوّد.",
};
