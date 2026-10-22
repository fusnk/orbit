import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Japanese strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "このアドオンの設定を更新しますか？",
  'prfixes.addons.update-detail': "{name} はすでにインストールされています。この設定で以前の設定が置き換わり、リスト内の位置はそのままです。",
  'prfixes.addons.update': "更新",
  'prfixes.audio.original': "元の言語を優先",
  'prfixes.audio.original-hint': "映像にその音声がある場合、映画やシリーズを制作された言語で再生します（アニメは日本語、韓国ドラマは韓国語）。それ以外は上の音声言語です。TMDB キーが必要です。",
  'prfixes.bundle.local': "このアドレスはこのコンピューターまたはホームネットワークを指しているため、Orbit は接続しませんでした。",
};
