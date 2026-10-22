import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': '직접 운영하는 Jellyfin 서버에서 재생해요. 서버에 있는 영화와 에피소드에는 Jellyfin 소스가 생기고, 서버의 행을 홈에 추가할 수 있어요. Orbit은 서버에서 받은 로그인 토큰만 보관하고 비밀번호는 보관하지 않아요.',
  'jellyfin.settings.server': '서버 주소',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': '사용자 이름',
  'jellyfin.settings.password': '비밀번호',
  'jellyfin.settings.fields-hint': '브라우저에서 Jellyfin을 여는 주소예요. Jellyfin 10.9 이상이 필요해요.',
  'jellyfin.settings.connect': '연결',
  'jellyfin.settings.connecting': '연결 중…',
  'jellyfin.settings.server-label': '서버',
  'jellyfin.settings.connected-as': '{server}에 {user}(으)로 연결됨',
  'jellyfin.settings.connected': '{server}에 연결됐어요.',
  'jellyfin.settings.connected-first': '{server}에 연결됐어요. 이제 홈에 “최근 추가됨”이 표시돼요. Jellyfin 행을 더 추가하려면 설정 → 홈 및 라이브러리 → 홈 행으로 가세요.',
  'jellyfin.settings.disconnect': '연결 해제',
  'jellyfin.settings.disconnected': '연결을 해제하고 서버에서 로그아웃했어요.',
  'jellyfin.settings.insecure': '안전하지 않음',
  'jellyfin.settings.insecure-title': '이 서버는 일반 http를 사용하므로 로그인 정보와 영상이 암호화되지 않은 채 전송돼요. 집 안에서는 괜찮지만 인터넷을 통해서는 https를 사용하세요.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': '이어서 보기',
  'jellyfin.rows.latest': '최근 추가됨',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': '먼저 설정 → 계정 및 서비스에서 Jellyfin 서버를 연결하세요.',
  'jellyfin.rows.libraries-failed': '서버의 라이브러리를 불러오지 못했어요.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
