import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "OpenAI, Gemini, Claude를 사용하면 자막 텍스트가 직접 입력한 API 키와 함께 해당 서비스로 전송되며, 그 서비스의 약관과 요금이 적용돼요. 로컬 서버(LM Studio, Ollama)는 모든 것을 이 PC에서 처리하며 비용이 들지 않아요.",
  'subtrans.error.overloaded': "지금 서비스에 요청이 몰려 있어요. 몇 분 후에 다시 시도해 주세요.",
};
