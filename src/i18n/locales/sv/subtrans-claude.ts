import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Med OpenAI, Gemini eller Claude skickas undertextens text till den tjänsten med din egen API-nyckel, och dess villkor och avgifter gäller. En lokal server (LM Studio, Ollama) håller allt på den här datorn och kostar ingenting.",
  'subtrans.error.overloaded': "Tjänsten är överbelastad just nu. Försök igen om några minuter.",
};
