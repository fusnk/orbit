/**
 * The trailer playing behind a title page's artwork or the Home and Discover
 * banner (Settings → Video; both off by default). It waits a moment, so
 * passing through fetches nothing, fades in once it plays, and fades back to
 * the artwork when it ends. It's muted unless the person chose sound, with a
 * speaker button to change that for the one playing.
 *
 * Leaving the page (or opening the player, which replaces it) pauses it: the
 * browser pauses media taken out of the page, and a page kept in it hidden
 * (Home, router.ts `keep`) pauses it once the next view shows. It lets go of the video then
 * so nothing keeps downloading unseen. Coming back picks it up where it was. A
 * hidden or minimised window pauses it too, so no sound plays unseen.
 */
import { invoke } from '@tauri-apps/api/core';
import { VIEW_SHOWN } from '../../app/router';
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { isShown } from '../../lib/shown';
import { settings } from '../../lib/ipc';
import { effectsReduced, reducedMotion } from '../../theme/appearance';
import { TRAILER_DELAY_KEY, TRAILER_SOUND_KEY, trailerDelayMs, trailerSound } from './trailer-settings';

/** What `trailer_preview` finds: the picture, and its sound when YouTube keeps that apart. */
interface Preview {
  video: string;
  audio: string | null;
}

/** How loud a trailer plays with its sound on: below full, as it starts without asking. */
const VOLUME = 0.6;
/** Picture and separate sound further apart than this (seconds) are brought back together. */
const MAX_DRIFT = 0.3;
/** About the fade back to the artwork, after which a stopped trailer lets go of its video. */
const FADE_MS = 1000;
/** Sent to each trailer on the page when the window is hidden or shown, or a view is shown. */
const CHECK = 'orbit:trailer-check';

/** Trailers count as motion and as a visual effect, so either setting turns them off. */
export function trailersAllowed(): boolean {
  return !reducedMotion() && !effectsReduced();
}

function checkAll(): void {
  for (const video of document.querySelectorAll('video[data-trailer]')) video.dispatchEvent(new Event(CHECK));
}
document.addEventListener('visibilitychange', checkAll);
// VIEW_SHOWN doesn't bubble, but a capturing listener up here still hears it.
document.addEventListener(VIEW_SHOWN, checkAll, true);

export interface HeroTrailerOptions {
  /** The setting that turns these trailers on; without one (Shorts, opened on purpose) they're always on. */
  setting?: string;
  /** The video's class, which places it behind the artwork's shade. */
  className: string;
  /** How long to wait before finding the trailer, in place of Settings → Video's delay. */
  delayMs?: number;
  /** Whether it starts with sound, in place of Settings → Video's choice. */
  sound?: () => boolean;
  /** Told when the speaker button turns the sound on or off. */
  onSound?: (on: boolean) => void;
  /** Plays it again from the start when it ends, instead of fading back to the artwork. */
  loop?: boolean;
}

export function createHeroTrailer({ setting, className, delayMs, sound: soundChoice, onSound, loop = false }: HeroTrailerOptions) {
  const video = h('video', { class: className, muted: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', 'data-trailer': true }) as HTMLVideoElement;
  video.muted = true;
  video.loop = loop;
  video.volume = VOLUME;
  // The sound, when it's a separate file: only fetched once the sound is on.
  const audio = h('audio', { preload: 'none', 'aria-hidden': 'true' });
  audio.volume = VOLUME;
  const button = h('button', { class: 'button glass icon-only trailer-sound', hidden: true, 'data-focus-id': 'trailer-sound' });

  /** The trailer asked for: a key (its YouTube id, or the title's id) and how to find its YouTube id. */
  let asked: { key: string; find: () => Promise<string | undefined> } | null = null;
  /** Waiting out the delay, finding the trailer, ready (it has a source), or done (it ended or failed). */
  let phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'done' = 'idle';
  /** Counts starts and stops, so an answer for an older one is dropped. */
  let run = 0;
  let timer: number | undefined;
  let muted = true;
  let separateSound = false;
  /** The picture and sound found, set on the elements only while the page is shown. */
  let found: Preview | null = null;
  /** Where it was when the page was left, to carry on from there. */
  let resumeAt = 0;

  const visible = () => isShown(video) && !document.hidden;

  function renderButton(): void {
    const label = muted ? t('titles.detail.trailer-unmute') : t('titles.detail.trailer-mute');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.replaceChildren(icon(muted ? 'volumeOff' : 'volume'));
  }

  function showButton(on: boolean): void {
    // Hiding the focused button would drop focus on the page: it moves to the hero's main button.
    if (!on && button === document.activeElement) button.closest('section')?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    button.hidden = !on;
  }

  /** Plays or holds the separate sound to match the picture and the speaker button. */
  function syncSound(): void {
    if (!separateSound) return void (video.muted = muted);
    if (muted || video.paused || !visible()) return audio.pause();
    if (Math.abs(audio.currentTime - video.currentTime) > MAX_DRIFT) audio.currentTime = video.currentTime;
    if (audio.paused) void audio.play().catch(soundRefused);
  }

  /** The WebView may refuse sound nobody clicked for: the trailer carries on muted, and the button can try again. */
  function soundRefused(): void {
    if (muted || phase !== 'ready') return;
    muted = true;
    renderButton();
    syncSound();
  }

  function playVideo(): void {
    video.muted = separateSound || muted;
    void video.play().catch(() => {
      if (video.muted || phase !== 'ready' || !visible()) return;
      soundRefused();
      void video.play().catch(() => {});
    });
  }

  /** It ended or failed: back to the artwork. */
  function finish(): void {
    phase = 'done';
    video.classList.remove('playing');
    audio.pause();
    showButton(false);
  }

  function begin(): void {
    const mine = ++run;
    const ask = asked!;
    phase = 'waiting';
    const read = (key: string) => settings.get(key).catch(() => null);
    void Promise.all([setting ? read(setting) : true, read(TRAILER_DELAY_KEY), read(TRAILER_SOUND_KEY)]).then(([on, delay, sound]) => {
      if (mine !== run) return;
      if (on !== true) {
        asked = null;
        phase = 'idle';
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        // Left or hidden during the pause: it starts again when shown.
        if (!visible()) return void (phase = 'idle');
        phase = 'loading';
        ask
          .find()
          .then((id) => (id ? invoke<Preview>('trailer_preview', { id }) : null))
          .then((preview) => {
            if (mine !== run) return;
            if (!preview) return finish();
            muted = !(soundChoice ? soundChoice() : trailerSound(sound));
            separateSound = !!preview.audio;
            renderButton();
            phase = 'ready';
            found = preview;
            resumeAt = 0;
            // Left while it was found: it loads and plays when the page is shown again.
            if (isShown(video)) attach();
            if (visible()) playVideo();
          })
          .catch(() => {
            if (mine === run) finish();
          });
      }, delayMs ?? trailerDelayMs(delay));
    });
  }

  /** Sets the found trailer on the elements, from where it was left. */
  function attach(): void {
    // A trailer that was just stopped may still hold its video while it fades out:
    // only the found trailer's own video counts as already attached.
    if (!found || video.getAttribute('src') === found.video) return;
    video.src = found.video;
    video.currentTime = resumeAt;
    if (found.audio) audio.src = found.audio;
    else audio.removeAttribute('src');
  }

  /** Lets go of the video and sound, remembering where they were. */
  function detach(): void {
    if (!video.getAttribute('src')) return;
    resumeAt = video.currentTime;
    video.removeAttribute('src');
    video.load();
    audio.removeAttribute('src');
    audio.load();
  }

  function stop(): void {
    run++;
    found = null;
    window.clearTimeout(timer);
    timer = undefined;
    asked = null;
    const had = phase === 'ready';
    phase = 'idle';
    video.classList.remove('playing');
    video.pause();
    audio.pause();
    showButton(false);
    if (!had) return;
    // Lets the picture fade back to the artwork before letting go of it.
    window.setTimeout(() => {
      if (phase === 'ready') return;
      video.removeAttribute('src');
      video.load();
      audio.removeAttribute('src');
      audio.load();
    }, FADE_MS);
  }

  function resume(): void {
    if (!visible()) return;
    if (phase === 'ready') attach();
    if (phase === 'ready' && video.paused && !video.ended) playVideo();
    else if (phase === 'idle' && asked) begin();
  }

  video.addEventListener('playing', () => {
    video.classList.add('playing');
    showButton(true);
    syncSound();
  });
  video.addEventListener('pause', () => {
    audio.pause();
    // Paused because the page was left (a redraw puts it straight back, so it isn't paused then).
    if (!isShown(video) && phase === 'ready') detach();
  });
  video.addEventListener('waiting', () => audio.pause());
  video.addEventListener('timeupdate', () => {
    if (separateSound && !muted) syncSound();
  });
  video.addEventListener('ended', () => {
    if (phase === 'ready') finish();
  });
  video.addEventListener('error', () => {
    if (phase === 'ready') finish();
  });
  video.addEventListener(CHECK, () => {
    if (visible()) return resume();
    video.pause();
    audio.pause();
  });
  button.addEventListener('click', () => {
    muted = !muted;
    renderButton();
    syncSound();
    onSound?.(!muted);
  });

  return {
    /** The video and its separate sound, placed behind the artwork's shade. */
    media: [video, audio] as const,
    /** The speaker button, shown while the trailer plays. */
    button,
    /**
     * Starts the trailer after the chosen delay, if its setting is on. `key` is
     * its YouTube id, unless `find` looks that up (only once the delay is over).
     * Asking again for the one already coming, playing or played changes
     * nothing (a page redraw mustn't replay one that ended). `requested`: the
     * person pressed Play, so Reduce motion or reduced effects don't hold it back.
     */
    start(key: string, find: () => Promise<string | undefined> = () => Promise.resolve(key), requested = false): void {
      if (asked?.key === key && phase !== 'idle') return;
      stop();
      if (!requested && !trailersAllowed()) return;
      asked = { key, find };
      begin();
    },
    /** Stops it at once, sound and all, and fades back to the artwork. */
    stop,
    /** Plays on after the page is shown or redrawn. */
    resume,
    /** Whether a trailer is being found or is playing (a banner holds its slide meanwhile). */
    busy: (): boolean => phase === 'loading' || (phase === 'ready' && !video.ended),
  };
}
