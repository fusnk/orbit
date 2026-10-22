import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'カスタム',
  'playertools.speed.custom-label': 'カスタム速度',
  'playertools.speed.slower': '遅く（−0.05×）',
  'playertools.speed.faster': '速く（+0.05×）',
  'playertools.subs.try-another': '別の字幕を試す',
  'playertools.subs.try-another-detail': '{language}で次に一致度の高い字幕',
  'playertools.subs.cycled': '字幕 {position}／{total} · {source}',
  'playertools.subs.no-other': '試せる字幕は他にありません',
  'playertools.paste.action': '字幕を貼り付け…',
  'playertools.paste.detail': 'SRTまたはWebVTTのテキスト',
  'playertools.paste.title': '字幕を貼り付け',
  'playertools.paste.hint': 'SRTまたはWebVTTファイルのテキストを貼り付けてください。この動画にのみ追加されます。',
  'playertools.paste.field': '字幕テキスト',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nこんにちは！',
  'playertools.paste.add': '字幕を追加',
  'playertools.paste.cancel': 'キャンセル',
  'playertools.paste.empty': '先に字幕テキストを貼り付けてください。',
  'playertools.paste.too-big': 'テキストが2 MBを超えています。',
  'playertools.paste.bad': 'SRTまたはWebVTTの字幕ではないようです。',
  'playertools.paste.added': '貼り付けた字幕を追加しました',
  'playertools.paste.name': '貼り付けた字幕',
  'playertools.caps.setting': 'すべて大文字の字幕を修正',
  'playertools.caps.hint': 'すべて大文字で書かれた行を通常の大文字・小文字表記に直します。アドオンの字幕、追加したファイル、貼り付けたテキストに適用され、動画ファイル内の字幕には適用されません。人名などの大文字も小文字になります。',
  'playertools.caps.error': '大文字修正の設定を適用できませんでした',
};
