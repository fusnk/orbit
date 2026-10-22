import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "OpenAI, Gemini veya Claude ile altyazının metni kendi API anahtarınla o hizmete gönderilir ve hizmetin koşulları ve ücretleri geçerli olur. Yerel bir sunucu (LM Studio, Ollama) her şeyi bu bilgisayarda tutar ve ücretsizdir.",
  'subtrans.error.overloaded': "Hizmet şu anda aşırı yüklü. Birkaç dakika sonra tekrar dene.",
};
