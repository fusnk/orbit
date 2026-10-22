import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "볼륨 증폭",
  'trybox.boost.note': "리미터가 증폭된 오디오의 왜곡을 막아 줘요.",
  'trybox.boost.off': "끄기",
  'trybox.boost.passthrough': "볼륨을 증폭하려면 오디오 패스스루를 끄세요.",
  'trybox.controls.title': "조작 버튼 크기",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "작게",
  'trybox.controls.medium': "중간",
  'trybox.controls.large': "크게",
  'trybox.info.pin': "화면에 재생 정보 표시",
  'trybox.info.dropped': "누락된 프레임",
  'trybox.info.fps': "프레임 속도",
  'trybox.hub.shortcuts': "단축키",
  'trybox.hub.controls': "조작 버튼 크기",
  'trybox.hub.info': "화면에 정보 표시",
  'trybox.subtitle.sample': "자막은 이렇게 표시돼요.",
  'trybox.subtitle.font': "글꼴",
};
