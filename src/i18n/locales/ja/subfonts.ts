import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': 'プレビュー',
  'subfonts.preview-hint': 'プレーヤーで表示される字幕のサンプルです。サイズや縁取りは近似で、実際の表示とまったく同じではありません。',
  'subfonts.fullscreen': '全画面プレビュー',
  'subfonts.fullscreen-close': 'Escを押すかクリックで閉じる',
  'subfonts.line1': 'まさかここまで来られるとは思わなかった。',
  'subfonts.line2': '私もだよ。このまま進もう。',
  'subfonts.font': 'フォント',
  'subfonts.font-label': '字幕のフォント',
  'subfonts.font-hint': 'Atkinson Hyperlegible、Lexend、OpenDyslexicは読みやすさを重視したフォントで、Orbitに同梱されています。スタイル付きの字幕は独自のフォントのままです。',
  'subfonts.default': 'デフォルト',
};
