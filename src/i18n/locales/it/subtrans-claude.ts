import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Con OpenAI, Gemini o Claude, il testo dei sottotitoli viene inviato a quel servizio con la tua chiave API, e valgono i suoi termini e costi. Un server locale (LM Studio, Ollama) tiene tutto su questo PC e non costa nulla.",
  'subtrans.error.overloaded': "Il servizio è sovraccarico in questo momento. Riprova tra qualche minuto.",
};
