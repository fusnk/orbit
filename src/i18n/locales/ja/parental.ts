import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // The profile editor's "Content limit" section
  'parental.heading': 'コンテンツ制限',
  'parental.level.off': 'オフ',
  'parental.level.kids': '子ども',
  'parental.level.older-kids': '年長の子ども',
  'parental.level.teens': '10代',
  'parental.level.no-adult': '成人向け以外すべて',
  'parental.about.off': 'アドオンが提供するすべての作品。',
  'parental.about.kids': '全年齢向けの作品のみ：G、TV-Y、TV-Y7、TV-G、またはお住まいの国の同等の区分（日本ではG）。',
  'parental.about.older-kids': 'PG、TV-PGも表示（日本ではPG12、その他の国ではおおむね11歳以下向けまで）。',
  'parental.about.teens': 'PG-13、TV-14も表示（英国では12と12A、ドイツではFSK 12）。',
  'parental.about.no-adult': 'R、TV-MAも表示（日本ではR15+とR18+）。成人限定の区分（NC-17、X、英国のR18）のみ非表示になります。',
  'parental.addons-note': '成人向けと表示されたアドオンは、制限のあるプロフィールではすべて非表示になります。',
  'parental.unrated': '年齢制限が不明な作品を表示',
  'parental.unrated-hidden': 'Orbitが年齢制限を見つけられない作品は非表示になります。IMDb IDを使わないアドオンの作品の多くが該当します。',
  'parental.unrated-shown': 'Orbitが年齢制限を見つけられない作品も表示されます。',
  'parental.live-tv': 'ライブTVを表示',
  'parental.live-tv-hint': 'テレビチャンネルには年齢制限の情報がないため、制限で絞り込むことはできません。',
  'parental.region': '年齢制限は、まず{country}、次に米国の区分で確認します。',
  'parental.needs-tmdb': '年齢制限はTMDBから取得しますが、TMDBが連携されていません（設定 → アカウントとサービス）。連携するまではすべての作品が年齢制限不明として扱われ、上のスイッチに関係なく、このプロフィールでは年齢制限不明の作品は表示されません。そのため、ほとんど何も表示されません。',
  'parental.no-parent': '制限のないプロフィールにPINが設定されていないため、誰でもこの制限を変更できます。自分のプロフィールにPINを設定してください。',
  'parental.open-profiles': 'このプロフィールからは、PINも制限もない{names}に切り替えられます。',
  'parental.who-changes': '制限をゆるめたり解除したりするには、制限のないプロフィールのPINが必要です。',
  'parental.badge': 'コンテンツ制限：{level}',
  // Asking for a parent's PIN
  'parental.parent-pin': '保護者のPIN',
  'parental.parent-pin-prompt': 'コンテンツ制限のないプロフィールのPINを入力してください。',
  'parental.parent-pin-create': 'コンテンツ制限のあるプロフィールがある間は、プロフィールを追加するのに制限のないプロフィールのPINが必要です。',
  // Where a limit stops something
  'parental.blocked.title': 'このプロフィールでは利用できません',
  'parental.blocked.rated': '{name}は{rating}に指定されており、このプロフィールの制限（{level}）を超えています。',
  'parental.blocked.adult': '{name}は成人向けコンテンツに指定されています。',
  'parental.blocked.unrated': 'Orbitは{name}の年齢制限を見つけられませんでした。このプロフィールでは年齢制限が不明な作品は非表示です。',
  'parental.blocked.toast': '{name}はこのプロフィールでは利用できません。',
  'parental.blocked.checking': 'Orbitが{name}の年齢制限を確認中です。わかり次第、このページが自動で開きます。',
  'parental.blocked.checking-toast': 'Orbitが{name}の年齢制限を確認中です。しばらくしてからもう一度お試しください。',
  'parental.blocked.unreachable': 'Orbitは今{name}の年齢制限を確認できませんでした。しばらくしてからもう一度お試しください。',
  'parental.blocked.live': 'このプロフィールではライブTVがオフになっています。',
};
