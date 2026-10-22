/**
 * Per-viewing adjustments in the player: audio and subtitle timing, the
 * picture's shape (aspect ratio, fit/fill/stretch), its adjustments
 * (brightness, contrast…; see picture.ts), night mode or a sound preset
 * (see sound.ts), and the fade to black and white on pause. mpv keeps
 * these across files, so they're all sent again whenever a player opens.
 * Timing is kept for the rest of a series (releases are usually off by the
 * same amount) and reset for another title; fit, picture and night mode are remembered.
 */
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { settings } from '../../lib/ipc';
import { DELAY_LIMIT, DELAY_STEP, FITS, formatDelay, type Aspect, type Fit } from './panels';
import { NEUTRAL, PICTURE_KEY, type Picture } from './picture';
import { SOUND_KEY, type SoundMode } from './sound';

export const ADJUSTMENT_SETTINGS = {
  /** 'fit' (default), 'fill' or 'stretch'. */
  fit: 'player.fit',
  /** Night mode on (default false). Kept in step with the sound mode, which took its place. */
  night: 'player.night',
  sound: SOUND_KEY,
} as const;

const FIT_NAMES: Record<Fit, string> = { fit: t('player.adjust.fit'), fill: t('player.adjust.fill'), stretch: t('player.adjust.stretch') };

export function createAdjustments(soft: (cmd: string, args: Record<string, unknown>, message: string) => void) {
  const delays = { audio: 0, sub: 0 };
  let delaysFor = '';
  let aspect: Aspect = 'no';
  let fit: Fit = 'fit';
  let picture: Picture = { ...NEUTRAL };
  let pictureSave: number | undefined;
  let sound: SoundMode = 'off';
  let normalize = false;
  /** How far the picture has faded to black and white (0 to 1; see grayscale-pause.ts). */
  let gray = 0;

  const sendAudio = () => soft('player_set_audio', { normalize, sound }, t('player.error.sound'));
  const sendPicture = () => soft('player_set_picture', { aspect, fit }, t('player.error.picture'));
  // mpv's own saturation does the fade: it's applied when the picture is drawn, so hardware decoding is untouched.
  const sendEqualizer = () => soft('player_set_equalizer', { ...picture, saturation: Math.round(picture.saturation + (-100 - picture.saturation) * gray) }, t('player.error.picture'));
  const sendDelay = (kind: 'audio' | 'sub') => soft('player_set_delay', { kind, seconds: delays[kind] }, t('player.error.timing'));

  function setDelay(kind: 'audio' | 'sub', seconds: number): void {
    delays[kind] = Math.max(-DELAY_LIMIT, Math.min(DELAY_LIMIT, Math.round(seconds * 10) / 10));
    sendDelay(kind);
  }

  function setFit(next: Fit): void {
    fit = next;
    sendPicture();
    void settings.set(ADJUSTMENT_SETTINGS.fit, next).catch(() => {});
  }

  return {
    delays: () => ({ ...delays }),
    aspect: () => aspect,
    fit: () => fit,
    picture: () => ({ ...picture }),
    sound: () => sound,
    /** A player opened: the saved choices, plus everything mpv may still hold from last time. */
    configure(options: { normalize: boolean; sound: SoundMode; fit: Fit; picture: Picture }): void {
      ({ normalize, sound, fit } = options);
      gray = 0;
      picture = { ...options.picture };
      aspect = 'no';
      delays.audio = 0;
      delays.sub = 0;
      sendAudio();
      sendPicture();
      sendEqualizer();
      sendDelay('audio');
      sendDelay('sub');
    },
    /** Another movie or show (not just the next episode) resets the timing. */
    newTitle(titleId: string): void {
      if (titleId === delaysFor) return;
      delaysFor = titleId;
      if (delays.audio) setDelay('audio', 0);
      if (delays.sub) setDelay('sub', 0);
    },
    setDelay,
    /** G/H (subtitles) and Shift+G/H (audio): one step, with a note of the new value. */
    nudge(kind: 'audio' | 'sub', direction: 1 | -1): void {
      setDelay(kind, delays[kind] + direction * DELAY_STEP);
      toast(t(kind === 'sub' ? 'player.adjust.subtitle-timing' : 'player.adjust.audio-timing', { delay: formatDelay(delays[kind]) }));
    },
    setAspect(next: Aspect): void {
      aspect = next;
      sendPicture();
    },
    setFit,
    /** Z: Fit → Fill → Stretch. */
    cycleFit(): Fit {
      const index = FITS.findIndex(([f]) => f === fit);
      const next = FITS[(index + 1) % FITS.length]![0];
      setFit(next);
      toast(FIT_NAMES[next]);
      return next;
    },
    /** Remembered, like Settings → Video → Picture; saved once a slider rests, not on every step. */
    setPicture(next: Picture): void {
      picture = { ...next };
      sendEqualizer();
      window.clearTimeout(pictureSave);
      pictureSave = window.setTimeout(() => void settings.set(PICTURE_KEY, picture).catch(() => {}), 400);
    },
    setSound(mode: SoundMode): void {
      sound = mode;
      sendAudio();
      void settings.set(ADJUSTMENT_SETTINGS.sound, mode).catch(() => {});
      void settings.set(ADJUSTMENT_SETTINGS.night, mode === 'night').catch(() => {});
    },
    /** The fade to black and white while paused: 0 is the picture as set, 1 fully grey. Not saved. */
    setGray(amount: number): void {
      const next = Math.min(1, Math.max(0, amount));
      if (next === gray) return;
      gray = next;
      sendEqualizer();
    },
  };
}
