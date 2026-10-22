import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "مع OpenAI أو Gemini أو Claude يُرسَل نص الترجمة إلى تلك الخدمة بمفتاح API الخاص بك، وتنطبق شروطها ورسومها. أما الخادم المحلي (LM Studio وOllama) فيُبقي كل شيء على هذا الحاسوب مجانًا.",
  'subtrans.error.overloaded': "الخدمة مثقلة بالطلبات الآن. حاول مجددًا بعد بضع دقائق.",
};
