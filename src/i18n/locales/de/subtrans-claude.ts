import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Mit OpenAI, Gemini oder Claude wird der Untertiteltext mit deinem eigenen API-Schlüssel an diesen Dienst gesendet; dessen Bedingungen und Kosten gelten. Ein lokaler Server (LM Studio, Ollama) behält alles auf diesem PC und kostet nichts.",
  'subtrans.error.overloaded': "Der Dienst ist gerade überlastet. Versuche es in ein paar Minuten erneut.",
};
