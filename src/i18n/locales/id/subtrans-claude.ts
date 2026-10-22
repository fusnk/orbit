import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "Dengan OpenAI, Gemini, atau Claude, teks subtitle dikirim ke layanan tersebut memakai kunci API Anda sendiri, dan ketentuan serta biayanya berlaku. Server lokal (LM Studio, Ollama) menyimpan semuanya di PC ini dan gratis.",
  'subtrans.error.overloaded': "Layanan sedang kelebihan beban. Coba lagi dalam beberapa menit.",
};
