import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'ネタバレ',
  'spoilers.intro': 'エピソードについて隠す内容です。番組のページ、プレーヤーのエピソード一覧、「次に再生」のカード、「続きを見る」に適用されます。',
  'spoilers.titles': 'エピソードのタイトルを隠す',
  'spoilers.titles-hint': 'エピソード名の代わりに「エピソード4」と表示します。',
  'spoilers.descriptions': 'エピソードの説明を隠す',
  'spoilers.descriptions-hint': '各エピソードのあらすじを表示しません。',
  'spoilers.thumbnails': 'エピソードの画像をぼかす',
  'spoilers.thumbnails-hint': 'エピソードにポイントするかフォーカスすると、少しだけ見られます。',
  'spoilers.ratings': 'エピソードの評価を隠す',
  'spoilers.ratings-hint': '評価から重要なエピソードが分かってしまうことがあります。',
  'spoilers.unaired': '今後のエピソードの放送日を隠す',
  'spoilers.unaired-hint': 'まだ公開されていないエピソードには「未放送」とだけ表示します。',
  'spoilers.scope': '適用対象',
  'spoilers.scope-hint': '「すべてのエピソード」を選ばない限り、見終わったエピソードや見始めたエピソードはすべて表示されます。',
  'spoilers.scope-unwatched': 'まだ見ていないエピソード',
  'spoilers.scope-all': 'すべてのエピソード',
};
