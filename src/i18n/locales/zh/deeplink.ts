import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Chinese text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': '通过网站上的安装链接打开。安装前请先检查下面的插件。',
  'deeplink.unusable': 'Orbit 无法使用该链接。这里只能打开插件安装链接（以 manifest.json 结尾）。',
  'deeplink.after-video': '收到了插件安装链接。视频结束后 Orbit 会打开它。',
  'deeplink.home-network': '在你的家庭网络中',
  'deeplink.home-network-note': '此链接指向这台电脑或你家庭网络中的某台设备。Orbit 尚未连接它。只有在你确定那里有插件时才继续。',
  'deeplink.continue': '继续',
};
