import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "З OpenAI, Gemini або Claude текст субтитрів надсилається до цього сервісу з вашим власним API-ключем, і діють його умови й тарифи. Локальний сервер (LM Studio, Ollama) залишає все на цьому комп’ютері й нічого не коштує.",
  'subtrans.error.overloaded': "Сервіс зараз перевантажений. Спробуйте ще раз за кілька хвилин.",
};
