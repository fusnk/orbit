import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Japanese text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Webサイトのインストールリンクから開かれました。インストールする前に、下のアドオンを確認してください。',
  'deeplink.unusable': 'Orbitはこのリンクを使用できません。ここで開けるのはアドオンのインストールリンク（manifest.jsonで終わるもの）だけです。',
  'deeplink.after-video': 'アドオンのインストールリンクを受け取りました。動画が終わったら Orbit が開きます。',
  'deeplink.home-network': 'ホームネットワーク上',
  'deeplink.home-network-note': 'このリンクはこのコンピューター、またはホームネットワーク上の機器を指しています。Orbitはまだ接続していません。そこにアドオンがあるとわかっている場合のみ続行してください。',
  'deeplink.continue': '続行',
};
