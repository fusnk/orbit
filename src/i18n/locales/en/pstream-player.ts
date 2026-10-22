/** English strings for the player additions inspired by P-Stream (speed and fine-seek keys, skip undo, episode progress, subtitle details and style, error retry…): the source every translation follows. */
export const pstreamPlayer = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Slower',
  'pstream.keys.speed-up': 'Faster',
  'pstream.keys.seek-back-small': 'Back 1 second (a frame while paused)',
  'pstream.keys.seek-forward-small': 'Forward 1 second (a frame while paused)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Ends at {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Back to {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Parts you can skip',
  'pstream.chapters.to-end': '{from} – end',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Mark {episode} as watched',
  'pstream.episodes.mark-unwatched': 'Mark {episode} as not watched',
  'pstream.episodes.watched': 'Watched',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Good match',
  'pstream.subs.match-fair': 'Fair match',
  'pstream.subs.match-poor': 'Poor match',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, in seconds',
  'pstream.timing.type': '{name}: {value}. Activate to type a value',
  'pstream.timing.invalid': 'Type seconds, like 1.5 or -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Subtitle timing reset for the new subtitle',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Subtitle style',
  'pstream.style.position': 'Position',
  'pstream.style.custom': 'Custom…',
  'pstream.style.hex': 'Colour code, like #ffcc00',
  'pstream.style.caps-note': 'Applies to subtitles added from now on.',
  'pstream.style.more': 'Text opacity, box colour and opacity, and outline colour are in Settings → Subtitles.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Try again',
  'pstream.error.retry-at': 'Try again from {time}',
  'pstream.error.copy': 'Copy details',
  'pstream.error.copied': 'Details copied. Addresses and keys were left out.',
  'pstream.error.copy-failed': 'Couldn’t copy the details',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Double-click the sides to jump',
  'pstream.settings.double-click-hint': 'Double-click the left or right third of the picture to jump back or forward by the jump length. The middle still switches full screen.',
};
