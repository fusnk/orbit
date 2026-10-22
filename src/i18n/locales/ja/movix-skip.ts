import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "AniSkipのアニメスキップ時間",
  'movix.aniskip-hint': "アニメでは、無料のコミュニティデータベースAniSkipにもオープニング、エンディング、あらすじの位置を問い合わせます。送信するのは作品のMyAnimeList IDと話数のみです。作品を特定するため、GitHubから公開IDリストをダウンロードすることがあります。オンにするまでオフです。",
  'movix.smooth': "なめらかスキップ",
  'movix.smooth-hint': "スキップ時に映像を一瞬黒くフェードさせて音量を下げ、その後元に戻します。「動きを減らす」がオンのときはすぐにスキップします。",
  'movix.button-delay': "スキップボタンを表示するまで",
  'movix.button-delay-hint': "イントロやクレジットの冒頭を少し再生してから「スキップ」を表示し、ボタンがシーンの終わりを隠さないようにします。自動スキップは待ちません。",
  'movix.button-delay-none': "すぐに",
  'movix.landing': "終わりの手前で再開",
  'movix.landing-hint': "イントロやあらすじが終わる少し手前に着地し、直後の場面が欠けないようにします。最後まで続くクレジットは、これまでどおり最後まで進みます。",
  'movix.landing-none': "終わりちょうど",
  'movix.color-intro': "イントロの色",
  'movix.color-recap': "あらすじの色",
  'movix.color-credits': "クレジットの色",
  'movix.color-preview': "次回予告の色",
  'movix.colors-hint': "シークバー上での各パートの色です。",
  'movix.swatch.default': "標準",
  'movix.swatch.amber': "アンバー",
  'movix.swatch.sky': "スカイブルー",
  'movix.swatch.mint': "ミント",
  'movix.swatch.rose': "ローズ",
  'movix.swatch.violet': "バイオレット",
  'movix.swatch.white': "ホワイト",
};
