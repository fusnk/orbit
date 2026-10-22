import type { subtransClaude as source } from '../en/subtrans-claude';
import type { Catalog } from '../types';

export const subtransClaude: Catalog<typeof source> = {
  'subtrans.settings.provider-claude': "Anthropic Claude",
  'subtrans.settings.privacy-services': "OpenAI、Gemini、Claudeを使う場合、字幕のテキストは自分のAPIキーでそのサービスに送信され、そのサービスの規約と料金が適用されます。ローカルサーバー（LM Studio、Ollama）ならすべてこのPC内で処理され、費用はかかりません。",
  'subtrans.error.overloaded': "サービスが現在過負荷です。数分後にもう一度お試しください。",
};
