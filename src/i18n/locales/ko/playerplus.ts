import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': '설정',
  'playerplus.hub.back': '{to}(으)로 돌아가기',
  'playerplus.hub.picture': '화질 및 화면',
  'playerplus.hub.sound': '사운드',
  'playerplus.hub.speed-note': '{key} 키를 누르고 있는 동안 2×로 재생해요.',
  'playerplus.hub.no-audio': '아직 오디오 트랙이 없어요. 영상을 불러오면 표시돼요.',
  'playerplus.hub.timing-sub': '자막 {delay}',
  'playerplus.hub.timing-audio': '오디오 {delay}',
  'playerplus.hub.timing-none': '조정 안 함',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': '소리가 먼저 나와요',
  'playerplus.timing.heard-first-hint': '자막이 늦어요: 더 일찍 표시',
  'playerplus.timing.saw-first': '자막이 먼저 나와요',
  'playerplus.timing.saw-first-hint': '자막이 빨라요: 더 늦게 표시',
  'playerplus.timing.earlier-by': '자막을 {value}초 일찍 표시',
  'playerplus.timing.later-by': '자막을 {value}초 늦게 표시',

  // Sound
  'playerplus.sound.off': '원음',
  'playerplus.sound.off-hint': '믹싱된 그대로의 사운드예요.',
  'playerplus.sound.cinema': '시네마',
  'playerplus.sound.cinema-hint': '풍성한 저음과 약간 더 트인 고음으로, 적당한 볼륨의 영화에 어울려요.',
  'playerplus.sound.music': '음악',
  'playerplus.sound.music-hint': '따뜻한 베이스와 밝은 고음으로, 콘서트와 뮤지컬에 어울려요.',
  'playerplus.sound.dialogue': '또렷한 대사',
  'playerplus.sound.dialogue-hint': '음악과 효과음보다 목소리를 앞으로 끌어내요.',
  'playerplus.sound.note': '한 번에 하나만 적용돼요. 모든 영상에 기억돼요.',

  // Live source search
  'playerplus.search.label': '{name}의 소스 찾는 중',
  'playerplus.search.finding': '애드온 찾는 중…',
  'playerplus.search.asking': '요청 중…',
  'playerplus.search.sources.one': '소스 {count}개',
  'playerplus.search.sources.other': '소스 {count}개',
  'playerplus.search.none': '결과 없음',
  'playerplus.search.failed': '응답 없음',
  'playerplus.search.progress.one': '애드온 {total}개 중 {count}개 응답 · 지금까지 소스 {found}개',
  'playerplus.search.progress.other': '애드온 {total}개 중 {count}개 응답 · 지금까지 소스 {found}개',

  // Time readout
  'playerplus.time.finish': '{left} 남음 · {time}에 종료',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': '인트로',
  'playerplus.bands.recap': '지난 줄거리',
  'playerplus.bands.credits': '엔딩 크레딧',
  'playerplus.bands.preview': '예고',

  // Skipping
  'playerplus.skip.preview': '예고 건너뛰기',
  'playerplus.skip.skipped-credits': '엔딩 크레딧을 건너뛰었어요',
  'playerplus.skip.skipped-preview': '예고를 건너뛰었어요',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds}초',
  'playerplus.bubble.back': '−{seconds}초',

  // Shortcut list
  'playerplus.cheat.action': '플레이어 단축키 보기',
  'playerplus.cheat.title': '플레이어 단축키',
  'playerplus.cheat.playback': '재생',
  'playerplus.cheat.sound': '사운드 및 자막',
  'playerplus.cheat.window': '화면 및 창',
  'playerplus.cheat.fixed': '항상',
  'playerplus.cheat.no-key': '키 없음',
  'playerplus.cheat.hold': '{key} 길게 누르기',
  'playerplus.keys.number-jump': '영상의 0–90% 위치로 이동',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': '누르고 있는 동안 2×로 재생',
  'playerplus.keys.hold-boost-keys': '{key} 길게 누르기',

  // Lock
  'playerplus.lock.action': '컨트롤 잠금',
  'playerplus.lock.unlock': '잠금 해제',
  'playerplus.lock.hint': '컨트롤이 잠겼어요. 잠금을 해제하려면 Esc를 세 번 누르세요.',
  'playerplus.lock.hint-key': '컨트롤이 잠겼어요. 잠금을 해제하려면 {key} 키를 누르거나 Esc를 세 번 누르세요.',
  'playerplus.lock.unlocked': '컨트롤 잠금 해제됨',

  // Docked episodes
  'playerplus.dock.collapse': '에피소드 숨기기',
  'playerplus.dock.expand': '에피소드 보기',
  'playerplus.dock.number': 'E{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': '길게 눌러 2× 속도',
  'playerplus.settings.hold-boost-hint': '재생/일시정지 키를 누르고 있으면 손을 뗄 때까지 2배속으로 재생해요. 짧게 누르면 그대로 일시정지돼요.',
  'playerplus.settings.number-jump': '숫자 키로 이동',
  'playerplus.settings.number-jump-hint': '1은 영상의 10%, 5는 절반, 0은 처음으로 이동해요. 다른 단축키를 지정한 키는 그 단축키를 유지해요.',
  'playerplus.settings.grayscale': '일시정지하면 흑백으로',
  'playerplus.settings.grayscale-hint': '일시정지한 화면이 회색으로 바뀌고, 다시 재생하면 색이 돌아와요.',
  'playerplus.settings.episodes': '에피소드 목록',
  'playerplus.settings.episodes-hint': '플로팅은 컨트롤 위에 열려요. 도킹은 오른쪽에 목록을 두고 작은 탭으로 접을 수 있어요.',
  'playerplus.settings.episodes-floating': '플로팅',
  'playerplus.settings.episodes-docked': '도킹',
  'playerplus.settings.skipping': '건너뛰기',
  'playerplus.settings.skipping-hint': '버튼은 해당 구간이 재생되는 동안 건너뛰기를 표시해요. 자동은 묻지 않고 건너뛰어요(한 번만: 보려면 그 구간으로 되돌아가세요).',
  'playerplus.settings.skip-intro': '인트로',
  'playerplus.settings.skip-recap': '지난 줄거리',
  'playerplus.settings.skip-credits': '엔딩 크레딧',
  'playerplus.settings.skip-preview': '엔딩 크레딧 뒤 예고',
  'playerplus.settings.skip-off': '끄기',
  'playerplus.settings.skip-button': '버튼',
  'playerplus.settings.skip-auto': '자동',
  'playerplus.settings.learn-skips': '인트로 건너뛰는 위치 학습',
  'playerplus.settings.learn-skips-hint': '시리즈에서 인트로를 직접 건너뛰면, 다른 건너뛰기 시간 정보가 없을 때 이후 에피소드에서 같은 시점에 인트로 건너뛰기를 제안해요. 이 기기의 이 프로필에만 저장돼요.',
  'playerplus.settings.forget-skips': '학습한 인트로 시간',
  'playerplus.settings.forget-skips-hint': '이 프로필의 모든 시리즈에서 학습한 인트로 시간을 지워요.',
  'playerplus.settings.forget-skips-action': '지우기',
  'playerplus.settings.forget-skips-done': '학습한 인트로 시간을 지웠어요',
};
