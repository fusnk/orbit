import type { iptvLocalAddress as source } from '../en/iptv-local-address';
import type { Catalog } from '../types';

/** Hebrew strings for a provider's playlist pointing a channel or replay at this computer or the home network. */
export const iptvLocalAddress: Catalog<typeof source> = {
  'errors.iptv.local-address': "הערוץ הזה מפנה לכתובת ברשת שלך, ורשימת השמעה של ספק לא רשאית לעשות זאת.",
};
