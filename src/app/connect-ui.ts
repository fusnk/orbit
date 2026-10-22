/**
 * Orbit Connect's controls (see connect-state.ts): the "Play on…" button and
 * its device menu, shown only while Connect is on and a paired device is
 * online, and the compact panel that controls another device's playback with
 * the player's own buttons. Plain buttons and menus, so a keyboard, a remote's
 * D-pad and a game controller work them as they do the rest of Orbit.
 */
import { invoke } from '@tauri-apps/api/core';
import { openDrawer } from '../components/drawer';
import { icon, type IconName } from '../components/icons';
import { openMenu, openMenuFrom, type MenuItem } from '../components/menu';
import { errorText } from '../components/state-message';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { clockTime, parseRemotePlayback, playTargets, stepVolume, type ConnectDevice, type ConnectPlay, type RemotePlayback } from '../lib/connect';
import { h } from '../lib/dom';
import { languageKey, languageName, UNKNOWN_LANGUAGE } from '../lib/languages';
import { CONNECT_CHANGED, connectState, handOff, playOn, remotePlayback } from './connect-state';
import { VIEW_DISCARDED } from './router';
import './connect.css';

/** "PC" or "TV". */
export const kindLabel = (device: Pick<ConnectDevice, 'kind'>): string => t(device.kind === 'tv' ? 'connect.kind.tv' : 'connect.kind.pc');

/** The page view `el` is drawn in: its ancestor right in the router's outlet (else its topmost). */
function viewOf(el: Element): Element {
  let view = el;
  while (view.parentElement && !view.parentElement.classList.contains('outlet')) view = view.parentElement;
  return view;
}

export interface PlayOnOptions {
  /** "This device": play here instead (left out where it's already playing here). */
  here?: () => void;
  /** What to send, or null if this can't be played elsewhere. */
  message: () => ConnectPlay | null;
  /** Whether it can be sent now (e.g. not a Live TV channel); the button hides otherwise. */
  available?: () => boolean;
  /** Once it's on its way to `device`; for a handoff, once it plays there (until then it plays on here). */
  sent?: (device: ConnectDevice) => void;
}

/**
 * Makes `button` a "Play on…" button: hidden unless Connect is on and a paired
 * device is online; pressing it lists This device and the devices to play on.
 * Returns a function that checks again whether it's shown.
 */
export function attachPlayOn(button: HTMLButtonElement, options: PlayOnOptions): () => void {
  button.setAttribute('aria-haspopup', 'menu');
  /** The page it was drawn on, once it's on screen. */
  let view: Element | undefined;
  const stop = () => document.removeEventListener(CONNECT_CHANGED, sync);
  const sync = () => {
    // Followed while its page is kept out of sight (another page shown over it), so it's right when that page
    // shows again; it stops once the page drew a new button in its place, or the page itself is dropped.
    if (!view && button.isConnected) {
      view = viewOf(button);
      view.addEventListener(VIEW_DISCARDED, stop, { once: true });
    } else if (view && !view.contains(button)) return stop();
    button.hidden = playTargets(connectState()).length === 0 || options.available?.() === false;
  };
  sync();
  document.addEventListener(CONNECT_CHANGED, sync);
  button.addEventListener('click', () => {
    const group = t('connect.play-on');
    const items: MenuItem[] = [
      ...(options.here ? [{ label: t('connect.this-device'), group, action: options.here }] : []),
      ...playTargets(connectState()).map((device) => ({ label: t('connect.device-label', { name: device.name, kind: kindLabel(device) }), group, action: () => void send(device) })),
    ];
    openMenuFrom(button, items);
  });
  async function send(device: ConnectDevice): Promise<void> {
    const message = options.message();
    if (!message) return toast(t('connect.failed'));
    const sent = message.handoff ? await handOff(device, message, await remotePlayback(device)) : await playOn(device, message);
    if (sent) options.sent?.(device);
  }
  return sync;
}

/** A round "Play on…" button for a title page. */
export function playOnButton(className: string, options: PlayOnOptions): HTMLButtonElement {
  const label = t('connect.play-on');
  const button = h('button', { class: className, title: label, 'aria-label': label, 'data-focus-id': 'play-on' }, icon('cast'));
  attachPlayOn(button, options);
  return button;
}

/** How often the panel asks the other device what it's playing. */
const POLL_MS = 1000;
const SEEK_STEP = 10;
const VOLUME_STEP = 5;

const trackLabel = (track: { id: number; title: string | null; lang: string | null }) => {
  const key = languageKey(track.lang);
  const language = key !== UNKNOWN_LANGUAGE ? languageName(key) : null;
  return [language, track.title].filter(Boolean).join(' · ') || `#${track.id}`;
};

/**
 * Controls `device`'s playback from here: what's playing, play/pause, ±10 s,
 * next, volume, audio and subtitle tracks, and stop. Every press is a checked
 * command on that device (its own rules decide); the panel shows what it says back.
 */
export function openRemoteControl(device: ConnectDevice): void {
  let playing: RemotePlayback | null = null;
  let timer: number | undefined;
  let closed = false;

  /** Runs `run` when `button` is pressed, unless it's shown as unavailable (see `unavailable`). */
  const onPress = (button: HTMLElement, run: () => void) => button.addEventListener('click', () => button.getAttribute('aria-disabled') !== 'true' && run());
  const control = (kind: IconName, label: string, run: () => void) => {
    const button = h('button', { class: 'button glass icon-only connect-remote-button', title: label, 'aria-label': label }, icon(kind));
    onPress(button, run);
    return button;
  };
  const send = (command: Record<string, unknown>) =>
    void invoke('connect_control', { id: device.id, command })
      // Its answer at once, rather than at the next poll.
      .then(() => poll())
      .catch((err: unknown) => toast(errorText(err, { fallback: 'connect.failed' })));

  const title = h('p', { class: 'connect-remote-title', dir: 'auto' });
  const detail = h('p', { class: 'connect-remote-detail', dir: 'auto' });
  const time = h('p', { class: 'connect-remote-time', dir: 'ltr' });
  const back = control('rewind', t('connect.remote.back', { seconds: SEEK_STEP }), () => send({ cmd: 'seek-by', seconds: -SEEK_STEP }));
  const playPause = control('pause', t('connect.remote.pause'), () => playing && send({ cmd: 'pause', on: !playing.playback.paused }));
  playPause.dataset.autofocus = '';
  const forward = control('forward', t('connect.remote.forward', { seconds: SEEK_STEP }), () => send({ cmd: 'seek-by', seconds: SEEK_STEP }));
  const next = control('next', t('connect.remote.next'), () => send({ cmd: 'next' }));
  const mute = control('volume', t('connect.remote.mute'), () => playing && send({ cmd: 'mute', on: !playing.playback.muted }));
  const quieter = control('volumeLow', t('connect.remote.quieter'), () => playing && send({ cmd: 'volume', level: stepVolume(playing.playback.volume, -VOLUME_STEP, playing.maxVolume) }));
  const louder = control('volumeMid', t('connect.remote.louder'), () => playing && send({ cmd: 'volume', level: stepVolume(playing.playback.volume, VOLUME_STEP, playing.maxVolume) }));
  const volume = h('span', { class: 'connect-remote-volume', dir: 'ltr' });
  const audio = h('button', { class: 'button glass', 'aria-haspopup': 'menu' }, t('connect.remote.audio'));
  onPress(audio, () => {
    if (!playing) return;
    openMenuFrom(audio, playing.audio.map((track) => ({ label: trackLabel(track), checked: () => track.selected, action: () => send({ cmd: 'audio', id: track.id }) })));
  });
  const subtitles = h('button', { class: 'button glass', 'aria-haspopup': 'menu' }, t('connect.remote.subtitles'));
  onPress(subtitles, () => {
    if (!playing) return;
    const off = !playing.subtitles.some((track) => track.selected);
    openMenuFrom(subtitles, [
      { label: t('connect.remote.subtitles-off'), checked: () => off, action: () => send({ cmd: 'subtitle', id: null }) },
      ...playing.subtitles.map((track) => ({ label: trackLabel(track), checked: () => track.selected, action: () => send({ cmd: 'subtitle', id: track.id }) })),
    ]);
  });
  const stop = h('button', { class: 'button glass' }, icon('close'), t('connect.remote.stop'));
  onPress(stop, () => send({ cmd: 'stop' }));
  const state = h('p', { class: 'setting-hint connect-remote-state', role: 'status' });
  const playerControls = [back, playPause, forward, next, mute, quieter, louder, audio, subtitles, stop];

  const content = h(
    'div',
    { class: 'connect-remote' },
    h('p', { class: 'connect-remote-device' }, icon('cast'), t('connect.device-label', { name: device.name, kind: kindLabel(device) })),
    title,
    detail,
    time,
    h('div', { class: 'connect-remote-row' }, back, playPause, forward, next),
    h('div', { class: 'connect-remote-row' }, mute, quieter, volume, louder),
    h('div', { class: 'connect-remote-row' }, audio, subtitles, stop),
    state,
  );

  // Shown as unavailable rather than disabled: a disabled button would drop the focus a remote or controller is on.
  const unavailable = (button: HTMLElement, off: boolean) => button.setAttribute('aria-disabled', String(off));
  // ...and does nothing when pressed, as a disabled one wouldn't (before the button's own listener, in the capture phase).
  content.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) event.stopPropagation();
    },
    true,
  );
  /** The status line is a live region: only a changed message is written, so a repeated error isn't read out every poll. */
  const say = (message: string) => {
    if (state.textContent !== message) state.textContent = message;
  };

  function render(): void {
    const p = playing;
    for (const button of playerControls) unavailable(button, !p);
    title.textContent = p ? p.title : t('connect.remote.nothing');
    detail.textContent = p?.detail ?? '';
    detail.hidden = !p?.detail;
    time.textContent = p && !p.live ? `${clockTime(p.playback.position)} / ${clockTime(p.playback.duration)}` : '';
    if (!p) return;
    const paused = p.playback.paused;
    const pauseLabel = t(paused ? 'connect.remote.play' : 'connect.remote.pause');
    playPause.replaceChildren(icon(paused ? 'play' : 'pause', { filled: true }));
    playPause.setAttribute('aria-label', pauseLabel);
    playPause.title = pauseLabel;
    mute.replaceChildren(icon(p.playback.muted ? 'volumeOff' : 'volume'));
    mute.setAttribute('aria-pressed', String(p.playback.muted));
    volume.textContent = p.playback.volume === null ? '' : `${Math.round(p.playback.volume)}%`;
    unavailable(next, !p.canNext);
    unavailable(back, p.live);
    unavailable(forward, p.live);
    unavailable(audio, p.audio.length < 2);
    unavailable(subtitles, p.subtitles.length === 0);
  }

  /** One question at a time: asked again while one is out, it's asked once that one is answered. */
  let asking = false;
  let again = false;
  function poll(): void {
    if (asking) {
      again = true;
      return;
    }
    asking = true;
    again = false;
    window.clearTimeout(timer);
    void invoke<unknown>('connect_remote_status', { id: device.id })
      .then((payload) => {
        const read = parseRemotePlayback(payload);
        playing = read ?? null;
        say('');
      })
      .catch((err: unknown) => {
        playing = null;
        say(errorText(err, { fallback: 'connect.failed' }));
      })
      .finally(() => {
        asking = false;
        if (closed) return;
        render();
        timer = window.setTimeout(poll, again ? 0 : POLL_MS);
      });
  }

  render();
  openDrawer(content, t('connect.remote.heading', { device: device.name }), () => {
    closed = true;
    window.clearTimeout(timer);
  });
  poll();
}

/** Opens a menu of the devices online to control (near the top of the window), or the one there is at once. */
export function chooseDeviceToControl(): void {
  const devices = playTargets(connectState());
  if (devices.length === 0) return toast(t('connect.none-online'));
  if (devices.length === 1) return openRemoteControl(devices[0]!);
  openMenu(
    { x: innerWidth / 2 - 120, y: innerHeight / 4 },
    devices.map((device) => ({ label: t('connect.device-label', { name: device.name, kind: kindLabel(device) }), group: t('connect.control'), action: () => openRemoteControl(device) })),
  );
}
