import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Con OpenAI, Gemini o Claude, el texto de los subtítulos se envía a ese servicio con tu propia clave de API, y se aplican sus condiciones y tarifas. Un servidor local (LM Studio, Ollama) lo mantiene todo en este PC y no cuesta nada.",
  'subtrans.error.overloaded': "El servicio está saturado ahora mismo. Inténtalo de nuevo en unos minutos.",
};
