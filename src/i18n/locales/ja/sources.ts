import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': '自動再生の制限',
  'sources.limits.any': '指定なし',
  'sources.limits.min-quality': 'この画質未満では自動再生しない',
  'sources.limits.min-quality-hint': '「再生」と次のエピソードでは、この画質以上のソースだけを開始します（画質が不明なソースは対象外）。該当するものがない場合は最適なソースを再生し、Orbitがお知らせします。ソースの一覧には引き続きすべて表示されます。このプロフィールのみに適用されます。',
  'sources.limits.max-quality': 'この画質を超えると自動再生しない',
  'sources.limits.max-quality-hint': '「再生」と次のエピソードでは、ほかに見つからない場合を除き、これを超えるソースを開始しません。「優先する最高画質」とは異なり、ソースの一覧の順番は変わりません。このプロフィールのみに適用されます。',
  'sources.limits.max-size': 'このサイズを超えるファイルは自動再生しない',
  'sources.limits.max-size-hint': '低速な回線やデータ通信量の上限がある場合向けです。「再生」と次のエピソードでは、これより大きいファイルを飛ばします。サイズが不明なソースには影響しません。このプロフィールのみに適用されます。',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': '自動再生の制限に合うものがないため、最適なソースを再生しています。',
  'sources.autoplay.only-uncached': '見つかったソースはすべてDebridサービスにダウンロード中です。開始するにはソースを選んでください。',
  // Quiet tags in the source list
  'sources.note.uncached': '未キャッシュ',
  'sources.note.uncached-hint': 'Debridサービスにダウンロード中のため、自動では開始されません',
  'sources.note.outside-limits': '自動再生の制限外',
  'sources.note.outside-limits-hint': '「再生」と次のエピソードでは選ばれません（設定 → アドオンとソース → ソースの設定 → 自動再生の制限）',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': '次に再生 · 放送日未確定',
};
