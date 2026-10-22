import type { looks as source } from '../en/looks';
import type { Catalog } from '../types';

export const looks: Catalog<typeof source> = {
  'looks.heading': 'ルック',
  'looks.hint': '1つ選ぶだけでOrbit全体のスタイルが変わります：テーマ、ホームのバナー、作品ページ、メニューの位置、プレーヤーのレイアウト。ルックで設定した項目は、下でそれぞれ変更できます。',
  'looks.presets-label': 'ルック',
  // Proper names: the same in every language.
  'looks.name.orbit': 'Orbit',
  'looks.name.crimson': 'Crimson',
  'looks.name.marquee': 'Marquee',
  'looks.name.premiere': 'Premiere',
  'looks.name.glass': 'Glass',
  'looks.name.aurora': 'Aurora',
  'looks.name.couch': 'Couch',
  'looks.name.afterglow': 'Afterglow',
  'looks.name.arc': 'Orbit Arc',
  'looks.orbit-hint': '標準のOrbit：標準テーマ、カード型バナー、上部メニュー、クラシックなプレーヤー。',
  'looks.crimson-hint': '黒と映画的な赤の一色、画面幅いっぱいのバナー、横長カード、ショーケースの作品ページ、シアタープレーヤー。',
  'looks.custom': 'カスタム',
  'looks.restore': '以前の設定に戻す',
  'looks.applied': '{name}を適用しました。',
  'looks.restored': '以前の設定に戻しました。',
};
