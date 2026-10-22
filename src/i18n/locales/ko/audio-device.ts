import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Korean strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "출력 장치",
  'audiodevice.hint': "소리가 재생되는 곳이에요. 시스템 기본값은 영상 재생 중에 바뀌더라도 컴퓨터의 선택을 따라요. 여기서 선택한 장치가 분리되면 다시 연결될 때까지 소리가 시스템 기본값으로 전환돼요.",
  'audiodevice.default': "시스템 기본값",
  'audiodevice.missing': "연결되지 않음: 시스템 기본값으로 재생 중",
  'audiodevice.error': "출력 장치를 바꾸지 못했어요",
};
