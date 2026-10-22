import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "С OpenAI, Gemini или Claude текст субтитров отправляется в этот сервис с вашим собственным API-ключом, и действуют его условия и тарифы. Локальный сервер (LM Studio, Ollama) оставляет всё на этом компьютере и ничего не стоит.",
  'subtrans.error.overloaded': "Сервис сейчас перегружен. Повторите попытку через несколько минут.",
};
