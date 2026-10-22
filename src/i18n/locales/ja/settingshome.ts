import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // One line under each category's title
  'settingshome.intro.general': '言語、Orbitの起動と終了、快適さ、通知、バックアップ。',
  'settingshome.intro.addons': 'カタログとストリームの取得元と、Orbitがソースを選ぶ方法。',
  'settingshome.intro.downloads': 'オフライン視聴のために、OrbitがこのPCに保存するもの。',
  'settingshome.intro.shortcuts': 'Orbitが反応するすべてのキーと、その動作。',
  'settingshome.intro.home-library': 'ホームの行、続きを見る、ネタバレ。',
  'settingshome.intro.subtitles': '字幕の言語と字幕の見た目。',
  'settingshome.intro.picture-sound': '映像、処理を行うハードウェア、音声の出力方法。',
  'settingshome.intro.accounts': 'Orbitと連携できるアカウントやサービスと、独自のライブTVソース。',
  // Search settings (opens the command palette on Settings)
  'settingshome.search.button': '設定を検索',
  'settingshome.search.placeholder': '設定を検索',
  'settingshome.search.none': '一致する設定はありません。',
  // The profile header's service lines
  'settingshome.connections': '連携済みのサービス',
  'settingshome.stremio.signed-in': 'Stremio · ログイン済み',
  'settingshome.stremio.synced': 'Stremio · {when}に同期',
  'settingshome.stremio.synced-now': 'Stremio · たった今同期',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // The save line
  'settingshome.saved': '保存しました',
  'settingshome.saved-announce': '設定を保存しました',
  // Settings → General → About Orbit
  'settingshome.about.heading': 'Orbitについて',
  'settingshome.about.version': 'バージョン{version}',
  'settingshome.about.made-by': '制作：{name}',
  'settingshome.about.licence': 'フリーソフトウェア · {licence}',
  'settingshome.about.source': 'ソースコード',
  'settingshome.about.licences': 'オープンソースライセンス',
  'settingshome.about.legal-heading': '法的情報',
  'settingshome.about.legal-independent': 'Orbitは独立したオープンソースのアプリです。Stremio、およびアプリ内で名前が挙がっているアドオン作者、サービス、企業とは提携しておらず、承認や支援も受けていません。{names}をはじめ、表示されるすべての名称とロゴはそれぞれの所有者に帰属し、Orbitが対応しているものを示す目的でのみ表示しています。',
  'settingshome.about.legal-content': 'Orbitはメディアをホスト、共有、インデックスしません。再生するものはすべて、自分で設定したアドオン、サービス、サーバーから提供されます。再生する内容と、お住まいの地域の法律を守ることについては、利用者自身が責任を負います。',
  // Settings → General → About Orbit: updates, and the banner when one is ready
  'settingshome.updates.label': 'アップデート',
  'settingshome.updates.check': 'アップデートを確認',
  'settingshome.updates.idle': 'Orbitは1日に1回アップデートを確認し、インストールする前にお知らせします。',
  'settingshome.updates.idle-manual': 'Orbitは確認を求められたときだけアップデートを確認し、インストールする前にお知らせします。',
  'settingshome.updates.idle-auto': 'Orbitは1日に1回アップデートを確認し、終了時にインストールします。',
  'settingshome.updates.idle-manual-auto': 'Orbitは確認を求められたときだけアップデートを確認し、終了時にインストールします。',
  'settingshome.updates.checking': 'アップデートを確認中…',
  'settingshome.updates.up-to-date': 'Orbitは最新です。',
  'settingshome.updates.downloading': 'Orbit {version}をダウンロード中…',
  'settingshome.updates.failed': 'アップデートを確認できませんでした。しばらくしてからもう一度お試しください。',
  'settingshome.updates.download-failed': 'Orbit {version} をダウンロードできませんでした。しばらくしてから自動でもう一度試します。',
  'settingshome.updates.off': 'このビルドではアップデートがオフになっています。',
  'settingshome.updates.ready': 'Orbit {version}の準備ができました',
  'settingshome.updates.restart': '再起動してアップデート',
  'settingshome.updates.later': '後で',
  'settingshome.updates.install-failed': 'アップデートをインストールできませんでした。しばらくしてからもう一度お試しください。',
  'settingshome.updates.auto': '自動でアップデート',
  'settingshome.updates.auto-hint': 'ダウンロード済みのアップデートを、Orbitの終了時にインストールします。オフのときは通知のみ行います。',
  'settingshome.updates.check-auto': 'アップデートを自動で確認',
  'settingshome.updates.check-auto-hint': '1日に1回、新しいバージョンを探します。オフのときは「アップデートを確認」を選んだときだけ確認します。',
  // Shown once after an update
  'settingshome.whats-new.heading': 'Orbit {version}の新機能',
  'settingshome.whats-new.plain': 'Orbitがバージョン{version}にアップデートされました。',
  'settingshome.whats-new.close': 'OK',
};
