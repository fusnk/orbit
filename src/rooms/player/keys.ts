/**
 * The player's keyboard shortcuts. Captured before the app's arrow-key
 * navigation and Back, so the player owns the keyboard while it's open.
 * Which key does what is the keymap's (Settings → Shortcuts); Escape, the
 * keyboard's media keys and the number keys (0–9 jump to 0–90%, unless one is
 * mapped to something) are fixed. Holding play/pause plays at 2× while held.
 */
import { isEditing } from '../../app/spatial';
import { t } from '../../i18n';
import { actionForEvent, firstKey, keymap, scopeOf, type ActionId } from '../../lib/keymap';
import { isAndroid } from '../../lib/platform';

export const VOLUME_STEP = 5;

/** A control's tooltip with its current key, e.g. "Mute (M)"; just the label when the action has no key. */
export function withKey(label: string, action: ActionId): string {
  const key = firstKey(action);
  return key ? t('player.controls.with-key', { label, key }) : label;
}

/**
 * The timing view's note on its keys, naming them as they're mapped now (Settings → Shortcuts);
 * null when one of them has no key, rather than naming a key that does nothing.
 */
export function timingNote(): string | null {
  const [subEarlier, subLater, audioEarlier, audioLater] = (['player.sub-earlier', 'player.sub-later', 'player.audio-earlier', 'player.audio-later'] as const).map(firstKey);
  if (!subEarlier || !subLater || !audioEarlier || !audioLater) return null;
  return t('player.tracks.timing-note', { subEarlier, subLater, audioEarlier, audioLater });
}

/** What the shortcuts act on: the player's elements, state and commands. */
export interface KeyTarget {
  view: HTMLElement;
  panel: HTMLElement;
  /** Other places whose buttons the keys work like a panel's (the docked episode list). */
  regions: readonly HTMLElement[];
  /** Other controls the arrows move between, like the bar's (the docked list's tab, Cinema's pills). */
  controls: readonly HTMLElement[];
  bar: HTMLElement;
  top: HTMLElement;
  volume: HTMLElement;
  /** Play/pause: where Enter (a remote's OK, a gamepad's A) puts focus when nothing has it. */
  toggle: HTMLElement;
  /** The seek bar and the time beside it: ← → seek there as anywhere, ↑ ↓ move on to the controls. */
  timeline: HTMLElement;
  closed(): boolean;
  /** The loading screen is asking whether to resume: keys work its buttons as usual. */
  asking(): boolean;
  panelOpen(): boolean;
  fullscreen(): boolean;
  /** Picture in picture is on. */
  pip(): boolean;
  togglePip(): void;
  status(): { paused: boolean; muted: boolean; volume: number | null };
  /** How far a jump goes, in seconds (Settings → Player). */
  seekStep(): number;
  showControls(): void;
  setPaused(paused: boolean): void;
  /** Play/pause's key went down: pauses, plays, or (held while playing) speeds up until `key` is let go (see hold-speed.ts). */
  playPause(key: string): void;
  seekBy(seconds: number): void;
  /** `,` and `.`: a second back or on while playing, a frame while paused. */
  fineSeek(direction: 1 | -1): void;
  /** `<` and `>`: the next slower or faster of the Speed view's pills. */
  stepSpeed(direction: 1 | -1): void;
  /** Number keys: jump to this fraction of the video (when they're on in Settings and it can seek). */
  jumpTo(fraction: number): boolean;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  /** The volume pop-up stands in for the controls (Settings → Playback): volume keys leave them hidden. */
  volumePopup(): boolean;
  /** The bars have faded out (nothing pressed or moved for a while). */
  controlsHidden(): boolean;
  setFullscreen(on: boolean): void;
  playNext(): void;
  playPrevious(): void;
  screenshot(): void;
  /** Subtitle or audio timing, one step earlier (-1) or later (1). */
  nudgeDelay(kind: 'audio' | 'sub', direction: 1 | -1): void;
  cycleFit(): void;
  chapter(step: 1 | -1): void;
  whatDidTheySay(): void;
  openTracks(): void;
  openTranscript(): void;
  toggleSubtitles(): void;
  /** The next best addon subtitle in the same language (see tracks.ts `nextOffer`). */
  tryAnotherSubtitle(): void;
  /** Esc or Back: closes an overlay (the shortcut list…) if one is up; true if it did. */
  dismiss(): boolean;
  /** Esc or Back in a panel: up one level, or closed. */
  panelBack(): void;
  lock(): void;
  /** `code` is the physical key, so its key-up matches even if Shift came up first ("?" would come up as "/"). */
  toggleShortcuts(code: string): void;
}

type PlayerAction = Exclude<Extract<ActionId, `player.${string}`>, 'player.channels'>;
const isPlayerAction = (id: ActionId): id is PlayerAction => scopeOf(id) === 'player' && id !== 'player.channels';

/** What each action does, and whether holding its key repeats it. */
function actions(p: KeyTarget): Record<PlayerAction, { repeat?: true; run(): void }> {
  const volumeBy = (step: number) => p.setVolume((p.status().volume ?? 100) + step);
  return {
    // Run with the key, so holding it can speed up (see playPause).
    'player.play-pause': { run: () => {} },
    'player.seek-back': { repeat: true, run: () => p.seekBy(-p.seekStep()) },
    'player.seek-forward': { repeat: true, run: () => p.seekBy(p.seekStep()) },
    'player.seek-back-small': { repeat: true, run: () => p.fineSeek(-1) },
    'player.seek-forward-small': { repeat: true, run: () => p.fineSeek(1) },
    'player.speed-down': { run: () => p.stepSpeed(-1) },
    'player.speed-up': { run: () => p.stepSpeed(1) },
    'player.volume-up': { repeat: true, run: () => volumeBy(VOLUME_STEP) },
    'player.volume-down': { repeat: true, run: () => volumeBy(-VOLUME_STEP) },
    'player.mute': { run: () => p.setMuted(!p.status().muted) },
    'player.fullscreen': { run: () => p.setFullscreen(!p.fullscreen()) },
    'player.pip': { run: () => p.togglePip() },
    'player.tracks': { run: () => p.openTracks() },
    'player.transcript': { run: () => p.openTranscript() },
    'player.subtitles': { run: () => p.toggleSubtitles() },
    'player.next-subtitle': { run: () => p.tryAnotherSubtitle() },
    'player.replay': { run: () => p.whatDidTheySay() },
    'player.sub-earlier': { repeat: true, run: () => p.nudgeDelay('sub', -1) },
    'player.sub-later': { repeat: true, run: () => p.nudgeDelay('sub', 1) },
    'player.audio-earlier': { repeat: true, run: () => p.nudgeDelay('audio', -1) },
    'player.audio-later': { repeat: true, run: () => p.nudgeDelay('audio', 1) },
    'player.chapter-previous': { run: () => p.chapter(-1) },
    'player.chapter-next': { run: () => p.chapter(1) },
    'player.fit': { run: () => p.cycleFit() },
    'player.screenshot': { run: () => p.screenshot() },
    'player.next': { run: () => p.playNext() },
    'player.previous': { run: () => p.playPrevious() },
    'player.lock': { run: () => p.lock() },
    'player.shortcuts': { run: () => {} },
  };
}

export function playerKeyHandler(p: KeyTarget): (event: KeyboardEvent) => void {
  const inRegion = (el: Element | null) => !!el && (p.panel.contains(el) || p.regions.some((r) => r.contains(el)));
  const inControls = (el: Element | null) => !!el && (p.bar.contains(el) || p.top.contains(el) || p.controls.some((c) => c.contains(el)) || inRegion(el));
  const run = actions(p);
  return (event) => {
    if (p.closed() || p.asking()) return;
    // Keys meant for something over the player (e.g. the source picker) aren't ours.
    if (event.target instanceof Node && event.target !== document.body && !p.view.contains(event.target)) return;
    const active = document.activeElement;
    const inPanel = inRegion(active);
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (plain && fixedKey(event, p, claim)) return;
    // The bars faded with one of their buttons still focused: OK (Enter) brings them back first, rather than
    // pressing a button nobody can see (a remote's OK is how people wake the controls, and it would skip to
    // the next episode or lock them out).
    if (plain && event.key === 'Enter' && p.controlsHidden() && !!active && (p.bar.contains(active) || p.top.contains(active))) {
      claim();
      p.showControls();
      return;
    }
    // Nothing focused (the player just opened, or the pointer was used): Enter reaches the controls,
    // as Tab does, so a remote or gamepad can work them too. Enter on anything focused is that thing's.
    // Not on Android: the native player screen takes the remote there, and this one's Play/Pause can be hidden.
    if (plain && !isAndroid && event.key === 'Enter' && (!active || active === document.body || active === p.view)) {
      claim();
      p.showControls();
      p.toggle.focus({ preventScroll: true });
      return;
    }
    // ← → on the volume slider change the volume, whatever they're mapped to.
    if (plain && active === p.volume && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      p.showControls();
      claim();
      p.setVolume((p.status().volume ?? 100) + (event.key === 'ArrowRight' ? VOLUME_STEP : -VOLUME_STEP));
      return;
    }
    const action = actionForEvent(keymap(), 'player', event, true);
    // 1–9 jump to 10–90% of the way in, 0 to the start; a digit mapped to an action is that action's.
    const digit = numberKey(event);
    if (!action && plain && digit !== null && !inPanel && !isEditing(event.target)) {
      if (event.repeat || p.jumpTo(digit / 10)) claim();
      if (!event.repeat) p.showControls();
      return;
    }
    const volumeKey = action === 'player.volume-up' || action === 'player.volume-down' || action === 'player.mute';
    if ((plain || action) && !(volumeKey && p.volumePopup())) p.showControls();
    // The channel list is channel-surf.ts's (it comes first, on Live TV).
    if (!action || !isPlayerAction(action)) return;
    // With a control focused, arrows move between controls; in a panel, other keys work its items (Space activates).
    // On the seek bar, ↑ ↓ leave it (they'd change the volume, and a remote could never get back to the controls).
    const leavesTimeline = (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !!active && p.timeline.contains(active);
    if (event.key.startsWith('Arrow') ? inControls(active) || leavesTimeline : inPanel) return;
    claim();
    const { repeat, run: act } = run[action];
    if (event.repeat && !repeat) return;
    if (action === 'player.play-pause') return p.playPause(event.key);
    if (action === 'player.shortcuts') return p.toggleShortcuts(event.code);
    act();
  };
}

/**
 * The number a key press is: the digit typed, or the number row's own digit where the layout types
 * something else there without Shift (AZERTY's "&é\"'(", Czech's "ěščř"). With Shift, only the
 * digit typed counts: Shift+1 is "!" on a US keyboard.
 */
function numberKey(event: KeyboardEvent): number | null {
  if (/^\d$/.test(event.key)) return Number(event.key);
  const row = /^Digit(\d)$/.exec(event.code)?.[1];
  return row !== undefined && !event.shiftKey ? Number(row) : null;
}

/** Escape and the media keys (a keyboard's or a TV remote's), which can't be remapped. Returns whether `event` was one. */
function fixedKey(event: KeyboardEvent, p: KeyTarget, claim: () => void): boolean {
  switch (event.key) {
    // Keyboard media keys (while Orbit is the active window), even inside a panel.
    case 'MediaPlayPause':
      p.showControls();
      claim();
      p.setPaused(!p.status().paused);
      return true;
    case 'MediaPlay':
    case 'MediaPause':
    case 'MediaStop':
      p.showControls();
      claim();
      p.setPaused(event.key !== 'MediaPlay');
      return true;
    case 'MediaTrackNext':
      p.showControls();
      claim();
      p.playNext();
      return true;
    case 'MediaTrackPrevious':
      p.showControls();
      claim();
      p.playPrevious();
      return true;
    // A TV remote's ⏩ ⏪ jump like → ←, by Settings → Player's step, and repeat while held.
    case 'MediaFastForward':
    case 'MediaRewind':
      p.showControls();
      claim();
      p.seekBy(event.key === 'MediaFastForward' ? p.seekStep() : -p.seekStep());
      return true;
    case 'Backspace':
      // Back closes an overlay or goes up a level in a panel, as Esc does; elsewhere it's the app's Back (leaving the player).
      if (isEditing(event.target)) return false;
      if (!event.repeat && p.dismiss()) {
        p.showControls();
        claim();
        return true;
      }
      if (!p.panelOpen()) return false;
      p.showControls();
      claim();
      if (!event.repeat) p.panelBack();
      return true;
    // A remote's Back button is Escape here too, so it closes a panel before it leaves the player.
    case 'BrowserBack':
    case 'Escape':
      // A slider being adjusted (see components/slider.ts) takes Escape first: it stops adjusting.
      if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.adjusting === 'true') return true;
      p.showControls();
      // Esc closes an overlay, goes up a level in a panel, then leaves picture in picture or full screen; otherwise it's Back.
      if (p.dismiss()) {
        claim();
      } else if (p.panelOpen()) {
        claim();
        p.panelBack();
      } else if (p.pip()) {
        claim();
        p.togglePip();
      } else if (p.fullscreen()) {
        claim();
        p.setFullscreen(false);
      }
      return true;
    default:
      return false;
  }
}
