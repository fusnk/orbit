import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Com OpenAI, Gemini ou Claude, o texto das legendas é enviado a esse serviço com sua própria chave de API, e os termos e cobranças dele se aplicam. Um servidor local (LM Studio, Ollama) mantém tudo neste PC e não custa nada.",
  'subtrans.error.overloaded': "O serviço está sobrecarregado agora. Tente de novo em alguns minutos.",
};
