/**
 * Where the floating pill sits (Theme Studio → Layout, Settings → Appearance):
 * six buttons in the pill's own 3×2 arrangement, top row first, each in
 * reading order. The grid mirrors in Arabic, where the start is the right,
 * so each button is named for the side it shows on.
 */
import { icon } from '../../components/icons';
import { isRtl, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { NAV_PLACES, type NavPlace } from '../../theme/layout';
import './pill-place.css';

/** Each place's name in left-to-right and right-to-left languages. */
const NAMES: Record<NavPlace, readonly [MessageKey, MessageKey]> = {
  'top-start': ['studio.layout.place-top-left', 'studio.layout.place-top-right'],
  top: ['studio.layout.place-top', 'studio.layout.place-top'],
  'top-end': ['studio.layout.place-top-right', 'studio.layout.place-top-left'],
  'bottom-start': ['studio.layout.place-bottom-left', 'studio.layout.place-bottom-right'],
  bottom: ['studio.layout.place-bottom', 'studio.layout.place-bottom'],
  'bottom-end': ['studio.layout.place-bottom-right', 'studio.layout.place-bottom-left'],
};

/** `onPick` runs only when the place changes. */
export function pillPlacePicker(current: NavPlace, onPick: (place: NavPlace) => void): HTMLElement {
  const rtl = isRtl();
  let chosen = current;
  const buttons = NAV_PLACES.map((place) => {
    const button = h(
      'button',
      { class: 'pill-place', 'aria-pressed': String(place === chosen), 'data-studio-key': `layout:place:${place}` },
      icon(place.startsWith('top') ? 'chevronUp' : 'chevronDown'),
      h('span', {}, t(NAMES[place][rtl ? 1 : 0])),
    );
    button.addEventListener('click', () => {
      if (place === chosen) return;
      chosen = place;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      onPick(place);
    });
    return button;
  });
  return h('div', { class: 'pill-places', role: 'group', 'aria-label': t('studio.layout.place') }, ...buttons);
}
