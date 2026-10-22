/**
 * The player's settings hub: the four things people change most (picture
 * quality, source, subtitles, audio) as a 2×2 grid, each with what it is
 * now, then rows for the rest. Each opens its view in the same panel, which
 * slides in with a Back button (see panel-controller.ts); Esc goes back up.
 */
import { icon, type IconName } from '../../components/icons';
import { h } from '../../lib/dom';
import { t } from '../../i18n';
import { PANEL_TITLES, type PanelKind } from './panels';

/** What each hub entry shows as its current value. */
export type HubValues = Partial<Record<PanelKind, string>>;

const TILES: readonly [PanelKind, IconName][] = [
  ['picture', 'film'],
  ['source', 'addons'],
  ['subtitles', 'subtitles'],
  ['audio', 'volume'],
];

const ROWS: readonly [PanelKind, IconName][] = [
  ['transcript', 'subtitles'],
  ['chapters', 'list'],
  ['speed', 'speed'],
  ['subtitle-style', 'pencil'],
  ['timing', 'swap'],
  ['sound', 'sliders'],
  ['sleep', 'clock'],
  ['info', 'info'],
];

/** The hub's focus id for an entry, so focus can return to it from its view. */
export const hubFocusId = (kind: PanelKind) => `hub-${kind}`;

/** The chips under the hub: the pinned info on screen (on or off), the controls size, the shortcuts. */
export interface HubChips {
  infoOnScreen: boolean;
  /** Turns the pinned info on or off; returns whether it's on now. */
  toggleInfo(): boolean;
  shortcuts?: () => void;
}

/** `hidden`: entries with nothing to show (Chapters, for a file without any). */
export function hubView(values: HubValues, open: (kind: PanelKind) => void, hidden: readonly PanelKind[] = [], extras?: HubChips): HTMLElement[] {
  const entry = (kind: PanelKind, iconName: IconName, className: string) => {
    const value = values[kind];
    const b = h(
      'button',
      { class: className, 'data-focus-id': hubFocusId(kind), 'aria-haspopup': 'true' },
      icon(iconName),
      h('span', { class: `${className}-text` }, h('span', { class: `${className}-label` }, PANEL_TITLES[kind]), value ? h('span', { class: `${className}-value` }, value) : ''),
      className === 'hub-row' ? icon('chevronRight') : '',
    );
    if (value) b.title = `${PANEL_TITLES[kind]}: ${value}`;
    b.addEventListener('click', () => open(kind));
    return b;
  };
  const footer = h('div', { class: 'hub-chips chips' });
  if (extras) {
    const info = h('button', { class: 'chip', 'data-focus-id': 'hub-info-hud', 'aria-pressed': String(extras.infoOnScreen) }, t('trybox.hub.info'));
    info.addEventListener('click', () => info.setAttribute('aria-pressed', String(extras.toggleInfo())));
    footer.append(info);
  }
  const size = h('button', { class: 'chip', 'data-focus-id': hubFocusId('controls-size') }, t('trybox.hub.controls'));
  size.addEventListener('click', () => open('controls-size'));
  footer.append(size);
  if (extras?.shortcuts) {
    const shortcuts = h('button', { class: 'chip', 'data-focus-id': 'hub-shortcuts' }, t('trybox.hub.shortcuts'));
    shortcuts.addEventListener('click', extras.shortcuts);
    footer.append(shortcuts);
  }
  return [
    h('div', { class: 'hub-grid' }, ...TILES.map(([kind, iconName]) => entry(kind, iconName, 'hub-tile'))),
    h('div', { class: 'hub-rows' }, ...ROWS.filter(([kind]) => !hidden.includes(kind)).map(([kind, iconName]) => entry(kind, iconName, 'hub-row'))),
    footer,
  ];
}
