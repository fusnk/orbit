import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "音量増幅",
  'trybox.boost.note': "リミッターが増幅した音声の音割れを防ぎます。",
  'trybox.boost.off': "オフ",
  'trybox.boost.passthrough': "音量を増幅するには音声パススルーをオフにしてください。",
  'trybox.controls.title': "操作ボタンのサイズ",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "小",
  'trybox.controls.medium': "中",
  'trybox.controls.large': "大",
  'trybox.info.pin': "再生情報を画面に表示",
  'trybox.info.dropped': "欠落フレーム",
  'trybox.info.fps': "フレームレート",
  'trybox.hub.shortcuts': "ショートカット",
  'trybox.hub.controls': "操作ボタンのサイズ",
  'trybox.hub.info': "画面に情報を表示",
  'trybox.subtitle.sample': "字幕はこのように表示されます。",
  'trybox.subtitle.font': "フォント",
};
