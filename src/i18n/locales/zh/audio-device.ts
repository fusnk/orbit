import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Chinese strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "输出设备",
  'audiodevice.hint': "声音在哪里播放。“系统默认”会跟随电脑的选择，即使在视频播放中途更改也一样。如果此处选择的设备被拔出，声音会切换到系统默认设备，直到它重新连接。",
  'audiodevice.default': "系统默认",
  'audiodevice.missing': "未连接：正在使用系统默认设备播放",
  'audiodevice.error': "无法更改输出设备",
};
