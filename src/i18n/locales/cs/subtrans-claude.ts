import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "S OpenAI, Gemini nebo Claude se text titulků posílá této službě s vaším vlastním API klíčem a platí její podmínky a poplatky. Místní server (LM Studio, Ollama) nechá vše na tomto počítači a nic nestojí.",
  'subtrans.error.overloaded': "Služba je teď přetížená. Zkuste to znovu za pár minut.",
};
