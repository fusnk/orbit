/**
 * Settings → Playback → Volume pop-up: while the controls are hidden, a
 * change of volume (keys, media keys) shows a small level instead of
 * bringing the whole control bar back. Off unless turned on.
 */
import { icon } from '../../components/icons';
import { isRtl, locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { volumeIcon } from './player-settings';
import './volume-popup.css';

export const VOLUME_POPUP_KEY = 'player.volume-popup';
export const VOLUME_POPUP_POSITION_KEY = 'player.volume-popup-position';
/** Where it shows; start and end follow the language (top left in English, top right in Arabic). */
export const VOLUME_POPUP_POSITIONS = ['center', 'top', 'top-start', 'top-end'] as const;
export type VolumePopupPosition = (typeof VOLUME_POPUP_POSITIONS)[number];
export const parseVolumePopupPosition = (value: unknown): VolumePopupPosition => VOLUME_POPUP_POSITIONS.find((p) => p === value) ?? 'center';

/** How long it stays after the last change. */
const SHOWN_MS = 1200;

export function createVolumePopup() {
  const level = h('span', { class: 'volume-popup-level' });
  const fill = h('span', { class: 'volume-popup-fill' });
  const glyph = h('span', { class: 'volume-popup-icon', 'aria-hidden': 'true' });
  const card = h('div', { class: 'volume-popup', role: 'status' }, glyph, h('span', { class: 'volume-popup-bar', 'aria-hidden': 'true' }, fill), level);
  // The player is left to right (its timeline); this follows the language, so "start" is the reading side.
  const element = h('div', { class: 'volume-popup-layer', dir: isRtl() ? 'rtl' : 'ltr', 'data-position': 'center' }, card);
  let timer: number | undefined;

  return {
    element,
    setPosition(position: VolumePopupPosition): void {
      element.dataset.position = position;
    },
    show(volume: number, muted: boolean, max: number): void {
      const shown = muted ? 0 : Math.round(volume);
      glyph.replaceChildren(icon(volumeIcon(shown, muted)));
      fill.style.setProperty('--fraction', String(Math.min(1, shown / max)));
      level.textContent = muted ? t('player.volume-popup.muted') : new Intl.NumberFormat(locale(), { style: 'percent' }).format(shown / 100);
      element.classList.add('shown');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => element.classList.remove('shown'), SHOWN_MS);
    },
    hide(): void {
      window.clearTimeout(timer);
      element.classList.remove('shown');
    },
  };
}
