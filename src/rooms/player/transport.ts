/**
 * The player's transport: play/pause, jumps back and forward (Settings →
 * Player sets how far), mute and volume, the seek bar
 * (with drag, hover time and preview, chapter marks and the intro/recap/credits
 * bands) and the time readout (see time-readout.ts). It sends commands and
 * draws whatever status mpv last reported; it holds no playback state.
 */
import { icon, showIcon } from '../../components/icons';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { formatTime } from './format';
import { withKey } from './keys';
import { DEFAULT_SEEK_STEP, volumeIcon } from './player-settings';
import { edgeShift } from './seek-hover';
import { BAND_NAMES, type Chapter, type Segment } from './skip';
import { nextTimeMode, timeReadout, type TimeMode } from './time-readout';

/** The parts of mpv's status the transport shows. */
export interface TransportStatus {
  timePos: number | null;
  duration: number | null;
  paused: boolean;
  volume: number | null;
  muted: boolean;
  cacheTime: number | null;
  speed: number | null;
  /** The sound goes to a receiver undecoded: its volume is set there, not here. */
  passthrough: boolean;
}

export interface TransportActions {
  status(): TransportStatus;
  setPaused(paused: boolean): void;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
  setMuted(muted: boolean): void;
  setVolume(level: number): void;
  /** Where the intro, recap, credits and preview are, for the bands on the bar. */
  segments(): readonly Segment[];
  /** The time readout was clicked to another mode (to remember). */
  timeModeChanged(mode: TimeMode): void;
}

export function createTransport(actions: TransportActions) {
  let dragging = false;
  let timeMode: TimeMode = 'remaining';
  /** The segments the bands were last drawn for. */
  let bandsFor = '';
  let chapters: Chapter[] = [];
  /** The duration the chapter marks were last placed for. */
  let marksFor = 0;
  let seekStep = DEFAULT_SEEK_STEP;
  /** 100, or 150 with "Allow volume above 100%" on. */
  let volumeMax = 100;
  /** Redraws the finish time as the clock moves on: paused, mpv reports nothing to redraw it with. */
  let clockTimer: number | undefined;

  const button = (label: string, className = 'player-button') => h('button', { class: className, title: label, 'aria-label': label });

  const toggle = button(withKey(t('player.controls.pause'), 'player.play-pause'), 'player-button large');
  toggle.dataset.autofocus = '';
  toggle.addEventListener('click', () => actions.setPaused(!actions.status().paused));

  const jump = (forward: boolean) => {
    const number = h('span', { class: 'skip-label', 'aria-hidden': 'true' });
    const b = button('', `player-button skip ${forward ? 'skip-ahead' : 'skip-back'}`);
    b.append(icon(forward ? 'forward' : 'rewind'), number);
    b.addEventListener('click', () => actions.seekBy(forward ? seekStep : -seekStep));
    /** Labels the button with the jump's length. */
    const label = () => {
      const text = t(forward ? 'player.controls.forward' : 'player.controls.rewind', { seconds: seekStep });
      b.title = withKey(text, forward ? 'player.seek-forward' : 'player.seek-back');
      b.setAttribute('aria-label', text);
      number.textContent = String(seekStep);
    };
    label();
    return { element: b, label };
  };
  const back = jump(false);
  const ahead = jump(true);

  const mute = button(withKey(t('player.controls.mute'), 'player.mute'));
  mute.addEventListener('click', () => actions.setMuted(!actions.status().muted));
  // ← → change the volume (player/keys.ts); ↑ ↓ move on to the next control, so the slider can't trap a remote or controller.
  const volume = h('input', { class: 'volume-slider', type: 'range', min: '0', max: '100', step: '1', 'aria-label': t('player.controls.volume'), 'data-nav-arrows': true });
  // Read as a percentage ("45%"), not a bare number.
  const percent = new Intl.NumberFormat(locale(), { style: 'percent' });
  const volumeText = () => volume.setAttribute('aria-valuetext', percent.format(Number(volume.value) / 100));
  volume.addEventListener('input', () => {
    volumeText();
    actions.setVolume(Number(volume.value));
  });

  const buffered = h('span', { class: 'seek-buffered' });
  const fill = h('span', { class: 'seek-fill' });
  const knob = h('span', { class: 'seek-knob' });
  const hoverTime = h('span', {});
  const canvas = h('canvas', { class: 'seek-preview', hidden: true });
  const hover = h('span', { class: 'seek-hover', 'aria-hidden': 'true' }, canvas, hoverTime);
  /** Where the pointer is on the bar (seconds), for matching previews that arrive late. */
  let hoverAt: number | null = null;
  /** Where a drag would seek to (seconds), shown in the time readout until it's let go. */
  let dragAt: number | null = null;
  let previews: { size(): [number, number] | null; request(seconds: number, draw: (frame: ImageData, seconds: number) => void): void } | null = null;
  const marks = h('span', { class: 'seek-marks', 'aria-hidden': 'true' });
  const bands = h('span', { class: 'seek-bands', 'aria-hidden': 'true' });
  const seek = h('div', { class: 'seek', role: 'slider', tabindex: '0', 'aria-label': t('player.controls.position'), 'aria-valuemin': '0' }, h('span', { class: 'seek-track' }, buffered, bands, marks, fill, knob), hover);

  /** A tinted stretch of the bar for each intro, recap, credits and preview, named in the hover time. */
  function placeBands(duration: number): void {
    const list = duration ? actions.segments() : [];
    const key = `${duration}|${list.map((s) => `${s.kind}${s.start}-${s.end}`).join()}`;
    if (key === bandsFor) return;
    bandsFor = key;
    bands.replaceChildren(
      ...list.map((s) => {
        const band = h('span', { class: `seek-band ${s.kind}` });
        band.style.setProperty('--from', String(s.start / duration));
        band.style.setProperty('--to', String(Math.min(1, s.end / duration)));
        return band;
      }),
    );
  }

  /** A small gap in the bar where each chapter starts (PageUp/PageDown jump between them). */
  function placeMarks(duration: number): void {
    marksFor = duration;
    marks.replaceChildren(
      ...chapters
        .filter((c) => c.time > 1 && c.time < duration - 1)
        .map((c) => {
          const mark = h('span', { class: 'seek-mark' });
          mark.style.setProperty('--fraction', String(c.time / duration));
          return mark;
        }),
    );
  }
  const time = h('button', { class: 'player-time', title: t('player.controls.time-toggle') });
  time.addEventListener('click', () => {
    timeMode = nextTimeMode(timeMode);
    actions.timeModeChanged(timeMode);
    followClock();
    render();
  });
  /** In the finish mode, the time it shows follows the clock (as the layout's clock does, every 15 s). */
  function followClock(): void {
    window.clearInterval(clockTimer);
    clockTimer = timeMode === 'finish' ? window.setInterval(drawTime, 15_000) : undefined;
  }

  // ── Seeking with the pointer ──
  const fractionAt = (event: PointerEvent) => {
    const rect = seek.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  function place(fraction: number): void {
    fill.style.setProperty('--fraction', String(fraction));
    knob.style.setProperty('--fraction', String(fraction));
  }
  /** Slides the hover box in from the window's edges (see seek-hover.ts); again when a preview changes its size. */
  function keepHoverInside(): void {
    const bar = seek.getBoundingClientRect();
    const fraction = Number(hover.style.getPropertyValue('--fraction')) || 0;
    hover.style.setProperty('--shift', `${edgeShift(bar.left + fraction * bar.width, hover.offsetWidth, document.documentElement.clientWidth)}px`);
  }
  /** While dragging: the knob, the readout and the hover time follow the pointer, wherever it goes. */
  function drag(fraction: number): void {
    const { duration } = actions.status();
    place(fraction);
    dragAt = duration ? fraction * duration : null;
    drawTime();
  }
  function stopDragging(): void {
    dragging = false;
    dragAt = null;
    seek.classList.remove('dragging');
    // Let go away from the bar: its hover time goes too.
    if (!seek.matches(':hover')) hideHover();
    drawTime();
  }
  function hideHover(): void {
    hoverAt = null;
    hover.classList.remove('shown');
    canvas.hidden = true;
  }
  seek.addEventListener('pointerdown', (event) => {
    // Only the main button (a touch, a pen) drags: a right or middle click isn't a seek.
    if (event.button !== 0 || !actions.status().duration) return;
    dragging = true;
    seek.classList.add('dragging');
    seek.setPointerCapture(event.pointerId);
    drag(fractionAt(event));
  });
  seek.addEventListener('pointermove', (event) => {
    const fraction = fractionAt(event);
    const { duration } = actions.status();
    if (duration) {
      const at = fraction * duration;
      hoverAt = at;
      const inside = actions.segments().find((s) => at >= s.start && at < s.end);
      hoverTime.textContent = inside ? t('playerplus.bands.at', { time: formatTime(at), part: t(BAND_NAMES[inside.kind]) }) : formatTime(at);
      hover.classList.add('shown');
      hover.style.setProperty('--fraction', String(fraction));
      keepHoverInside();
      const size = previews?.size();
      if (size && previews) {
        previews.request(at, (frame, seconds) => {
          // Drop a frame that arrives after the pointer moved well away.
          if (hoverAt === null || Math.abs(seconds - hoverAt) > 15) return;
          canvas.width = frame.width;
          canvas.height = frame.height;
          canvas.getContext('2d')?.putImageData(frame, 0, 0);
          canvas.hidden = false;
          keepHoverInside();
        });
      }
    }
    if (dragging) drag(fraction);
  });
  // Mid-drag the time stays up, even with the pointer off the bar.
  seek.addEventListener('pointerleave', () => {
    if (!dragging) hideHover();
  });
  seek.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    // Let go first: with no duration (a source switching mid-drag) there's nowhere to seek, but the drag is over all the same.
    stopDragging();
    const { duration } = actions.status();
    if (duration) actions.seekTo(fractionAt(event) * duration);
  });
  // A touch gesture the system takes over, or a lost capture, ends the drag without a seek; the next status update puts the bar back.
  const endDrag = () => {
    if (dragging) stopDragging();
  };
  seek.addEventListener('pointercancel', endDrag);
  seek.addEventListener('lostpointercapture', endDrag);

  /** The readout: where a drag would land while dragging, else where playback is. */
  function drawTime(): void {
    const status = actions.status();
    const duration = status.duration ?? 0;
    time.textContent = timeReadout(timeMode, dragAt ?? status.timePos ?? 0, duration, status.speed ?? 1, Date.now(), locale());
    time.classList.toggle('finish', timeMode === 'finish' && !!duration);
  }

  function render(): void {
    const status = actions.status();
    const { paused, muted } = status;
    showIcon(toggle, paused ? 'play' : 'pause', { filled: true });
    toggle.title = withKey(paused ? t('player.controls.play') : t('player.controls.pause'), 'player.play-pause');
    toggle.setAttribute('aria-label', paused ? t('player.controls.play-label') : t('player.controls.pause-label'));

    const level = status.volume ?? 100;
    showIcon(mute, volumeIcon(level, muted));
    mute.title = withKey(muted ? t('player.controls.unmute') : t('player.controls.mute'), 'player.mute');
    mute.setAttribute('aria-label', muted ? t('player.controls.unmute-label') : t('player.controls.mute-label'));
    // Not while it's being dragged (mpv's report of an earlier step would pull the thumb back); focused by
    // keyboard it follows, as ← → and M change the volume there (see keys.ts) without moving it themselves.
    if (!(document.activeElement === volume && volume.matches(':active'))) volume.value = String(Math.round(muted ? 0 : level));
    volumeText();
    volume.style.setProperty('--fraction', String(Math.min(1, (muted ? 0 : level) / volumeMax)));
    volume.disabled = status.passthrough;
    volume.title = status.passthrough ? t('player.passthrough.volume') : '';

    const duration = status.duration ?? 0;
    const pos = status.timePos ?? 0;
    if (duration !== marksFor) placeMarks(duration);
    placeBands(duration);
    if (!dragging) place(duration ? Math.min(1, pos / duration) : 0);
    // How much has played, from mpv's own position: the Arc layout's Play ring fills with it (layout.css).
    toggle.style.setProperty('--played', String(duration ? Math.min(1, pos / duration) : 0));
    buffered.style.setProperty('--fraction', String(duration && status.cacheTime ? Math.min(1, status.cacheTime / duration) : 0));
    drawTime();
    seek.setAttribute('aria-valuemax', String(Math.round(duration)));
    seek.setAttribute('aria-valuenow', String(Math.round(pos)));
    seek.setAttribute('aria-valuetext', t('player.controls.position-value', { position: formatTime(pos), duration: formatTime(duration) }));
  }

  return {
    /** Play/pause, the jumps, and volume: the start of the control bar. */
    start: h('div', { class: 'player-bar-start' }, toggle, back.element, ahead.element, h('div', { class: 'player-volume' }, mute, volume)),
    /** The seek bar and time readout, above the control bar. */
    seekRow: h('div', { class: 'player-seek-row' }, seek, time),
    toggle,
    volume,
    render,
    /** The remembered time readout. */
    setTimeMode(mode: TimeMode): void {
      timeMode = mode;
      followClock();
      render();
    },
    /** How far the jump buttons go, in seconds. */
    setSeekStep(seconds: number): void {
      seekStep = seconds;
      back.label();
      ahead.label();
    },
    /** The slider's top: 100, or 150 with a mark at 100 when the volume may go above it. */
    setVolumeMax(max: number): void {
      volumeMax = max;
      volume.max = String(max);
      volume.classList.toggle('boost', max > 100);
      volume.style.setProperty('--tick', String(100 / max));
      render();
    },
    /** Turns hover previews on (with the source) or off (null). */
    setPreviews(source: typeof previews): void {
      previews = source;
      canvas.hidden = true;
    },
    /** The playing file's chapters (none for most streams). */
    setChapters(next: Chapter[]): void {
      chapters = next;
      placeMarks(actions.status().duration ?? 0);
    },
    /** While the seek bar is being dragged, the controls stay up and it ignores position updates. */
    dragging: () => dragging,
    /** The player closed. */
    dispose(): void {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    },
  };
}
