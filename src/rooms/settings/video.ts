/** Settings → Picture & Sound → Picture: picture quality and adjustments, how mpv decodes it, HDR output (and its subtitles' brightness) and smooth motion. (Trailers and seek bar previews are under Playback.) */
import { createSwitch } from '../../components/switch';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { HWDEC_KEY } from '../player/next-up';
import { QUALITY_NAMES } from '../player/panels';
import { LEGACY_LOOK_KEY, parsePicture, parsePictureQuality, PICTURE_KEY, PICTURE_QUALITIES, PICTURE_QUALITY_KEY, type Picture, type PictureQuality } from '../player/picture';
import { pictureControls } from '../player/picture-controls';
import { HDR_KEY, HDR_SUBTITLES_KEY, SMOOTH_MOTION_PREFIX } from '../player/player-settings';
import { profileSetting } from '../../library/profiles';
import { showDependents } from './dependent-rows';
import { choices, row, save } from './playback';
import './video.css';

const QUALITY_TEXT: Record<PictureQuality, { who: MessageKey; description: MessageKey }> = {
  fast: { who: 'settings.video.quality-fast-who', description: 'settings.video.quality-fast-description' },
  balanced: { who: 'settings.video.quality-balanced-who', description: 'settings.video.quality-balanced-description' },
  high: { who: 'settings.video.quality-high-who', description: 'settings.video.quality-high-description' },
};

/** The presets as radio cards: name, who it's for, what it does. */
function qualityCards(current: PictureQuality): HTMLElement {
  const cards = PICTURE_QUALITIES.map((quality) => {
    const card = h(
      'button',
      { class: 'quality-card', role: 'radio', 'aria-checked': String(quality === current), 'data-focus-id': `quality-${quality}` },
      h('span', { class: 'quality-card-name' }, t(QUALITY_NAMES[quality])),
      h('span', { class: 'quality-card-who' }, t(QUALITY_TEXT[quality].who)),
      h('span', { class: 'quality-card-description' }, t(QUALITY_TEXT[quality].description)),
    );
    card.addEventListener('click', () => {
      for (const c of cards) c.setAttribute('aria-checked', String(c === card));
      void save(PICTURE_QUALITY_KEY, quality);
    });
    return card;
  });
  return h('div', { class: 'quality-cards', role: 'radiogroup', 'aria-label': t('settings.video.quality') }, ...cards);
}

/** A switch labelled for screen readers by its row, saving `key` (then `then`). */
function settingSwitch(label: string, key: string, on: boolean, then?: (on: boolean) => void): HTMLElement {
  const control = createSwitch('', on, (value) => {
    then?.(value);
    void save(key, value);
  });
  control.setAttribute('aria-label', label);
  return control;
}

/** A setting whose control sits under its text. */
function stacked(label: string, hint: string, control: HTMLElement): HTMLElement {
  const element = row(label, hint, control);
  element.classList.add('stacked');
  return element;
}

export function videoPanel(): HTMLElement {
  const panel = h('div', {});
  const keys = [HWDEC_KEY, PICTURE_KEY, LEGACY_LOOK_KEY, HDR_KEY, PICTURE_QUALITY_KEY, HDR_SUBTITLES_KEY];
  void Promise.all([
    Promise.all(keys.map((key) => settings.get(key).catch(() => null))),
    profileSetting(SMOOTH_MOTION_PREFIX).catch(() => ({ key: SMOOTH_MOTION_PREFIX, value: null })),
  ]).then(([[hwdec, picture, legacyLook, hdr, quality, hdrSubtitles], smooth]) => {
    // Saved once a slider rests, not on every step.
    let pictureSave: number | undefined;
    const savePicture = (next: Picture) => {
      window.clearTimeout(pictureSave);
      pictureSave = window.setTimeout(() => void save(PICTURE_KEY, next), 400);
    };
    // Softer subtitles only apply while HDR plays in HDR (Rust, player/mod.rs).
    const hdrSubtitlesRow = row(t('settings.video.hdr-subtitles'), t('settings.video.hdr-subtitles-hint'), settingSwitch(t('settings.video.hdr-subtitles'), HDR_SUBTITLES_KEY, hdrSubtitles !== false));
    const hdrRow = row(t('settings.video.hdr'), t('settings.video.hdr-hint'), settingSwitch(t('settings.video.hdr'), HDR_KEY, hdr === true, (on) => showDependents(hdrRow, [hdrSubtitlesRow], on)));
    showDependents(hdrRow, [hdrSubtitlesRow], hdr === true);
    panel.replaceChildren(
      stacked(t('settings.video.quality'), t('settings.video.quality-hint'), qualityCards(parsePictureQuality(quality))),
      stacked(t('settings.video.picture'), t('settings.video.picture-hint'), pictureControls(parsePicture(picture, legacyLook), savePicture, 'settings-picture')),
      row(
        t('settings.video.hwdec'),
        t('settings.video.hwdec-hint'),
        choices(t('settings.video.hwdec'), [['auto', t('settings.common.auto')], ['off', t('settings.common.off')]] as const, hwdec === 'off' ? 'off' : 'auto', (v) => void save(HWDEC_KEY, v)),
      ),
      hdrRow,
      hdrSubtitlesRow,
      // Per profile: the key carries this profile's id.
      row(t('settings.video.smooth-motion'), t('settings.video.smooth-motion-hint'), settingSwitch(t('settings.video.smooth-motion'), smooth.key, smooth.value === true)),
    );
  });
  return panel;
}
