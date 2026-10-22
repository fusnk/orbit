import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Japanese strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "このリンクを再生",
  'pastelink.play-magnet': "このマグネットリンクを再生",
  'pastelink.magnet': "マグネットリンク",
  'pastelink.source': "貼り付けたリンク",
  'pastelink.detail': "プレーヤーで開きます。視聴履歴には何も保存されません。",
  'pastelink.torrents-off.title': "マグネットリンクにはトレントを有効にする必要があります",
  'pastelink.torrents-off.detail': "Orbit はマグネットリンクを内蔵のトレントプレーヤーで再生しますが、現在オフになっています。トレントは設定でオンにできます。",
  'pastelink.torrents-off.open': "設定を開く",
};
