import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "W przypadku OpenAI, Gemini lub Claude tekst napisów jest wysyłany do tej usługi z Twoim własnym kluczem API i obowiązują jej warunki oraz opłaty. Serwer lokalny (LM Studio, Ollama) zatrzymuje wszystko na tym komputerze i nic nie kosztuje.",
  'subtrans.error.overloaded': "Usługa jest teraz przeciążona. Spróbuj ponownie za kilka minut.",
};
