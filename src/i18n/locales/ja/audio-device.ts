import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Japanese strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "出力デバイス",
  'audiodevice.hint': "音声を再生する場所です。「システムの既定」はコンピューターの選択に従い、動画の途中で変わっても追従します。ここで選んだデバイスが取り外されると、戻るまで音声はシステムの既定に切り替わります。",
  'audiodevice.default': "システムの既定",
  'audiodevice.missing': "未接続: システムの既定で再生中",
  'audiodevice.error': "出力デバイスを変更できませんでした",
};
