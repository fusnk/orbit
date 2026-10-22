import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Korean text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': '웹사이트의 설치 링크로 열렸어요. 설치하기 전에 아래 애드온을 확인하세요.',
  'deeplink.unusable': 'Orbit에서 이 링크를 사용할 수 없어요. 여기서는 애드온 설치 링크(manifest.json으로 끝나는 링크)만 열려요.',
  'deeplink.after-video': '애드온 설치 링크를 받았어요. 영상이 끝나면 Orbit이 열어 드릴게요.',
  'deeplink.home-network': '홈 네트워크에 있음',
  'deeplink.home-network-note': '이 링크는 이 컴퓨터나 홈 네트워크의 기기를 가리켜요. Orbit은 아직 연결하지 않았어요. 그곳에 애드온이 있다고 확신할 때만 계속하세요.',
  'deeplink.continue': '계속',
};
