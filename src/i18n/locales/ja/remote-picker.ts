import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Japanese strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'ブラウズ',
  'remote.phone.browse-loading': 'ホームを読み込み中…',
  'remote.phone.browse-empty': 'まだ表示するものがありません。Orbitでカタログのアドオンを追加すると、ホームに表示されます。',
  'remote.phone.browse-failed': 'ホームを読み込めませんでした。もう一度お試しください。',
  'remote.phone.refresh': '更新',
  'remote.phone.moods': '今の気分は？',
  'remote.phone.mood-loading': 'おすすめを探しています…',
  'remote.phone.mood-empty': '今はこの気分のおすすめがありません。',
  'remote.phone.surprise': 'おまかせ',
  'remote.phone.surprise-hint': 'カタログからランダムに1本選びます。',
  'remote.phone.surprise-movie': '映画',
  'remote.phone.surprise-series': '番組',
  'remote.phone.surprise-none': '今は新しく提案できるものがありません。もう一方の種類を試すか、Orbitでおまかせの条件を変更してください。',
  'remote.phone.details-loading': '詳細を読み込み中…',
  'remote.phone.details-failed': 'この作品を読み込めませんでした。もう一度お試しください。',
  'remote.phone.add-library': 'ライブラリに追加',
  'remote.phone.in-library': 'ライブラリにあります',
  'remote.phone.close': '閉じる',
  'remote.phone.season': 'シーズン{number}',
  'remote.phone.specials': 'スペシャル',
  'remote.phone.episodes': 'エピソード',
  'remote.phone.rating': 'IMDb評価 {rating}',
};
