import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': '사용자 지정',
  'playertools.speed.custom-label': '사용자 지정 속도',
  'playertools.speed.slower': '느리게 (−0.05×)',
  'playertools.speed.faster': '빠르게 (+0.05×)',
  'playertools.subs.try-another': '다른 자막 시도',
  'playertools.subs.try-another-detail': '{language}의 다음으로 잘 맞는 자막',
  'playertools.subs.cycled': '자막 {position}/{total} · {source}',
  'playertools.subs.no-other': '시도할 다른 자막이 없어요',
  'playertools.paste.action': '자막 붙여넣기…',
  'playertools.paste.detail': 'SRT 또는 WebVTT 텍스트',
  'playertools.paste.title': '자막 붙여넣기',
  'playertools.paste.hint': 'SRT 또는 WebVTT 파일의 텍스트를 붙여 넣으세요. 이 영상에만 추가돼요.',
  'playertools.paste.field': '자막 텍스트',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\n안녕하세요!',
  'playertools.paste.add': '자막 추가',
  'playertools.paste.cancel': '취소',
  'playertools.paste.empty': '먼저 자막 텍스트를 붙여 넣으세요.',
  'playertools.paste.too-big': '텍스트가 2 MB를 넘어요.',
  'playertools.paste.bad': 'SRT 또는 WebVTT 자막이 아닌 것 같아요.',
  'playertools.paste.added': '붙여 넣은 자막을 추가했어요',
  'playertools.paste.name': '붙여 넣은 자막',
  'playertools.caps.setting': '대문자로만 된 자막 고치기',
  'playertools.caps.hint': '모두 대문자로 쓰인 대사를 일반 문장 표기로 바꿔요. 애드온 자막, 추가한 파일, 붙여 넣은 텍스트에 적용되며 영상 파일에 포함된 자막에는 적용되지 않아요. 이름도 대문자가 사라져요.',
  'playertools.caps.error': '대문자 자막 설정을 적용하지 못했어요',
};
