import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "使用 OpenAI、Gemini 或 Claude 时，字幕文本会用你自己的 API 密钥发送到该服务，并适用其条款和费用。本地服务器（LM Studio、Ollama）会把一切留在这台电脑上，而且免费。",
  'subtrans.error.overloaded': "服务当前过载。请过几分钟再试。",
};
