/**
 * The picture adjustments as controls: one-tap looks and a slider for each
 * of brightness, contrast, saturation and gamma. Drawn in Settings → Video
 * and in the player's Playback & picture panel; `onChange` gets every change
 * (the player applies it at once).
 */
import { createSlider } from '../../components/slider';
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import './picture-controls.css';
import { LOOK_VALUES, LOOKS, lookOf, NEUTRAL, PICTURE_FIELDS, PICTURE_MAX, PICTURE_MIN, type LookId, type Picture, type PictureField } from './picture';

const FIELD_NAMES: Record<PictureField, MessageKey> = {
  brightness: 'player.picture.brightness',
  contrast: 'player.picture.contrast',
  saturation: 'player.picture.saturation',
  gamma: 'player.picture.gamma',
};

const LOOK_NAMES: Record<LookId, MessageKey> = {
  brighten: 'player.picture.look-brighten',
  punchy: 'player.picture.look-punchy',
  gentle: 'player.picture.look-gentle',
  crisp: 'player.picture.look-crisp',
};

const signed = (n: number) => new Intl.NumberFormat(locale(), { signDisplay: 'exceptZero' }).format(n);

export function pictureControls(initial: Picture, onChange: (picture: Picture) => void, focusPrefix = 'picture'): HTMLElement {
  let picture = { ...initial };

  const chips = [...LOOKS.map((look) => [look, t(LOOK_NAMES[look])] as const), ['neutral', t('player.picture.look-reset')] as const].map(([look, label]) => {
    const chip = h('button', { class: 'chip', 'data-focus-id': `${focusPrefix}-look-${look}` }, label);
    chip.addEventListener('click', () => {
      picture = { ...(look === 'neutral' ? NEUTRAL : LOOK_VALUES[look]) };
      sync();
      onChange(picture);
    });
    return [look, chip] as const;
  });

  const sliders = PICTURE_FIELDS.map((field) => {
    const slider = createSlider({
      label: t(FIELD_NAMES[field]),
      min: PICTURE_MIN,
      max: PICTURE_MAX,
      value: picture[field],
      format: signed,
      focusId: `${focusPrefix}-${field}`,
      onInput: (value) => {
        picture = { ...picture, [field]: value };
        syncChips();
        onChange(picture);
      },
    });
    return [field, slider] as const;
  });

  /** A look is pressed while the sliders hold exactly its values (Reset while they're all 0). */
  function syncChips(): void {
    const current = lookOf(picture);
    for (const [look, chip] of chips) chip.setAttribute('aria-pressed', String(look === current));
  }
  function sync(): void {
    syncChips();
    for (const [field, slider] of sliders) slider.setValue(picture[field]);
  }
  syncChips();

  return h(
    'div',
    { class: 'picture-controls' },
    h('div', { class: 'chips panel-chips', role: 'group', 'aria-label': t('player.picture.looks') }, ...chips.map(([, chip]) => chip)),
    h('div', { class: 'picture-sliders' }, ...sliders.map(([, slider]) => slider)),
  );
}
