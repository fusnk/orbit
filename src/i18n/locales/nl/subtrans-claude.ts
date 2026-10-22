import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Met OpenAI, Gemini of Claude wordt de tekst van de ondertitels met je eigen API-sleutel naar die dienst gestuurd, en gelden diens voorwaarden en kosten. Een lokale server (LM Studio, Ollama) houdt alles op deze pc en kost niets.",
  'subtrans.error.overloaded': "De dienst is op dit moment overbelast. Probeer het over een paar minuten opnieuw.",
};
