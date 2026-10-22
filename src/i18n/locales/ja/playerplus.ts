import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': '設定',
  'playerplus.hub.back': '{to}に戻る',
  'playerplus.hub.picture': '画質と映像',
  'playerplus.hub.sound': 'サウンド',
  'playerplus.hub.speed-note': '{key}を押し続けている間は2×で再生します。',
  'playerplus.hub.no-audio': 'まだ音声トラックがありません。動画の読み込みが終わると表示されます。',
  'playerplus.hub.timing-sub': '字幕 {delay}',
  'playerplus.hub.timing-audio': '音声 {delay}',
  'playerplus.hub.timing-none': '調整なし',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': '先に聞こえた',
  'playerplus.timing.heard-first-hint': '字幕が遅れています：早めに表示します',
  'playerplus.timing.saw-first': '先に表示された',
  'playerplus.timing.saw-first-hint': '字幕が早すぎます：遅らせて表示します',
  'playerplus.timing.earlier-by': '字幕を{value}秒早く表示',
  'playerplus.timing.later-by': '字幕を{value}秒遅く表示',

  // Sound
  'playerplus.sound.off': 'オリジナル',
  'playerplus.sound.off-hint': 'ミックスされたままのサウンドです。',
  'playerplus.sound.cinema': 'シネマ',
  'playerplus.sound.cinema-hint': '低音に厚みを、高音に少し広がりを加えます。十分な音量で映画を見るときに。',
  'playerplus.sound.music': 'ミュージック',
  'playerplus.sound.music-hint': '温かみのある低音と明るい高音。ライブやミュージカル向けです。',
  'playerplus.sound.dialogue': 'セリフを明瞭に',
  'playerplus.sound.dialogue-hint': '音楽や効果音よりも声を前に出します。',
  'playerplus.sound.note': '一度に1つだけ選べます。すべての動画で記憶されます。',

  // Live source search
  'playerplus.search.label': '{name}のソースを検索中',
  'playerplus.search.finding': 'アドオンを探しています…',
  'playerplus.search.asking': '問い合わせ中…',
  'playerplus.search.sources.one': '{count}件のソース',
  'playerplus.search.sources.other': '{count}件のソース',
  'playerplus.search.none': '結果なし',
  'playerplus.search.failed': '応答なし',
  'playerplus.search.progress.one': '{total}件中{count}件のアドオンが応答 · これまでに{found}件のソース',
  'playerplus.search.progress.other': '{total}件中{count}件のアドオンが応答 · これまでに{found}件のソース',

  // Time readout
  'playerplus.time.finish': '残り{left} · {time}に終了',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'イントロ',
  'playerplus.bands.recap': 'あらすじ',
  'playerplus.bands.credits': 'クレジット',
  'playerplus.bands.preview': '次回予告',

  // Skipping
  'playerplus.skip.preview': '次回予告をスキップ',
  'playerplus.skip.skipped-credits': 'クレジットをスキップしました',
  'playerplus.skip.skipped-preview': '次回予告をスキップしました',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds}秒',
  'playerplus.bubble.back': '−{seconds}秒',

  // Shortcut list
  'playerplus.cheat.action': 'プレーヤーのショートカットを表示',
  'playerplus.cheat.title': 'プレーヤーのショートカット',
  'playerplus.cheat.playback': '再生',
  'playerplus.cheat.sound': 'サウンドと字幕',
  'playerplus.cheat.window': '映像とウィンドウ',
  'playerplus.cheat.fixed': '固定',
  'playerplus.cheat.no-key': 'キーなし',
  'playerplus.cheat.hold': '{key}を長押し',
  'playerplus.keys.number-jump': '動画の0〜90%の位置へ移動',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': '押している間2×で再生',
  'playerplus.keys.hold-boost-keys': '{key}を長押し',

  // Lock
  'playerplus.lock.action': 'コントロールをロック',
  'playerplus.lock.unlock': 'ロック解除',
  'playerplus.lock.hint': 'コントロールはロックされています。Escを3回押すと解除します。',
  'playerplus.lock.hint-key': 'コントロールはロックされています。{key}を押すか、Escを3回押すと解除します。',
  'playerplus.lock.unlocked': 'コントロールのロックを解除しました',

  // Docked episodes
  'playerplus.dock.collapse': 'エピソードを隠す',
  'playerplus.dock.expand': 'エピソードを表示',
  'playerplus.dock.number': 'E{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': '長押しで2×速',
  'playerplus.settings.hold-boost-hint': '再生／一時停止キーを押し続けている間は2倍速で再生します。短く押すと一時停止します。',
  'playerplus.settings.number-jump': '数字キーで移動',
  'playerplus.settings.number-jump-hint': '1で動画の10%、5で半分、0で先頭に移動します。別のショートカットを割り当てたキーはそのまま使えます。',
  'playerplus.settings.grayscale': '一時停止中は白黒',
  'playerplus.settings.grayscale-hint': '一時停止中の映像がグレーになり、再生すると色が戻ります。',
  'playerplus.settings.episodes': 'エピソード一覧',
  'playerplus.settings.episodes-hint': 'フローティングはコントロールの上に開きます。ドッキングは右側に一覧を表示し、小さなタブに折りたためます。',
  'playerplus.settings.episodes-floating': 'フローティング',
  'playerplus.settings.episodes-docked': 'ドッキング',
  'playerplus.settings.skipping': 'スキップ',
  'playerplus.settings.skipping-hint': '「ボタン」は再生中にスキップボタンを表示し、「自動」は確認せずにスキップします（1回のみ。見たいときはその部分まで戻ってください）。',
  'playerplus.settings.skip-intro': 'イントロ',
  'playerplus.settings.skip-recap': 'あらすじ',
  'playerplus.settings.skip-credits': 'エンドクレジット',
  'playerplus.settings.skip-preview': 'クレジット後の次回予告',
  'playerplus.settings.skip-off': 'オフ',
  'playerplus.settings.skip-button': 'ボタン',
  'playerplus.settings.skip-auto': '自動',
  'playerplus.settings.learn-skips': 'イントロをスキップした位置を学習',
  'playerplus.settings.learn-skips-hint': 'シリーズでイントロを手動でスキップすると、他にスキップ時間が分からない場合、以降のエピソードでも同じ位置で「イントロをスキップ」を表示します。このプロフィール用に、このデバイスに保存されます。',
  'playerplus.settings.forget-skips': '学習したイントロの時間',
  'playerplus.settings.forget-skips-hint': 'このプロフィールで全シリーズについて学習したイントロの時間を消去します。',
  'playerplus.settings.forget-skips-action': '消去',
  'playerplus.settings.forget-skips-done': '学習したイントロの時間を消去しました',
};
