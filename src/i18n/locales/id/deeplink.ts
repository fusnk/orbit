import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Indonesian text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Dibuka dari tautan pemasangan di sebuah situs web. Periksa add-on di bawah sebelum memasangnya.',
  'deeplink.unusable': 'Orbit tidak dapat menggunakan tautan itu. Hanya tautan pemasangan add-on (berakhiran manifest.json) yang terbuka di sini.',
  'deeplink.after-video': 'Tautan pemasangan add-on diterima. Orbit akan membukanya setelah video selesai.',
  'deeplink.home-network': 'Di jaringan rumah Anda',
  'deeplink.home-network-note': 'Tautan ini mengarah ke komputer ini atau ke perangkat di jaringan rumah Anda. Orbit belum menghubunginya. Lanjutkan hanya jika Anda memang mengharapkan add-on di sana.',
  'deeplink.continue': 'Lanjutkan',
};
