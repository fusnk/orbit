import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Avec OpenAI, Gemini ou Claude, le texte des sous-titres est envoyé à ce service avec votre propre clé d’API, et ses conditions et tarifs s’appliquent. Un serveur local (LM Studio, Ollama) garde tout sur ce PC et ne coûte rien.",
  'subtrans.error.overloaded': "Le service est surchargé pour le moment. Réessayez dans quelques minutes.",
};
