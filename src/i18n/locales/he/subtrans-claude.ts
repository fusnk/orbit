import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "עם OpenAI, Gemini או Claude, טקסט הכתוביות נשלח לשירות עם מפתח ה-API שלך, והתנאים והחיובים שלו חלים. שרת מקומי (LM Studio, Ollama) משאיר הכול במחשב הזה ולא עולה כלום.",
  'subtrans.error.overloaded': "השירות עמוס מדי כרגע. אפשר לנסות שוב בעוד כמה דקות.",
};
