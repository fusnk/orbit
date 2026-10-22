import { t } from '../i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { icon } from '../components/icons';
import { h } from '../lib/dom';
import { isAndroid } from '../lib/platform';

/**
 * The app header, which is also the frameless window's title bar: back and
 * wordmark on the left, the page nav in the middle, the paused-history chip,
 * the avatar, the new-episode bell, Quick settings and the Windows caption buttons on the right. The header itself is the drag region; its
 * buttons aren't marked, so they stay clickable. Android has no window to move or resize: no caption buttons there.
 */
export function createTitlebar(options: { nav: HTMLElement; onBack(): void; onHome(): void; onSettings(anchor: HTMLElement): void; profile?: HTMLElement | undefined; bell?: HTMLElement | undefined; historyChip?: HTMLElement | undefined }) {
  const win = getCurrentWindow();

  const back = h('button', { class: 'round-button back-button', title: t('browse.titlebar.back-shortcut'), 'aria-label': t('browse.titlebar.back'), hidden: true }, icon('chevronLeft'));
  back.addEventListener('click', options.onBack);

  const wordmark = h('button', { class: 'wordmark', 'aria-label': t('browse.titlebar.home') }, brandMark(), 'orbit');
  wordmark.addEventListener('click', options.onHome);

  // Opens Quick settings; its "All settings" (and the Settings shortcut, Ctrl+, by default) lead to the full page.
  const settings = h('button', { class: 'round-button settings-button', title: t('quick.button'), 'aria-label': t('quick.button'), 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon('sliders'));
  settings.addEventListener('click', () => options.onSettings(settings));

  // Window controls are mouse targets; keyboard users have Alt+F4 and Win+arrows.
  const caption = (label: string, glyph: HTMLElement | SVGSVGElement, action: () => Promise<void>, extra = '') => {
    const button = h('button', { class: `caption-button ${extra}`.trim(), title: label, 'aria-label': label, tabindex: '-1', 'data-nav-skip': true }, glyph);
    button.addEventListener('click', () => void action());
    return button;
  };
  // In full screen (kept after closing the player, Settings → Playback) this button leaves it:
  // there's no other control for that outside the player.
  let fullscreen = false;
  const maximize = caption(t('browse.titlebar.maximize'), h('span', { class: 'glyph-max' }), () => (fullscreen ? win.setFullscreen(false).then(syncMaximized) : win.toggleMaximize()));
  const syncMaximized = () =>
    void Promise.all([win.isMaximized(), win.isFullscreen()]).then(([max, full]) => {
      fullscreen = full;
      maximize.title = full ? t('player.controls.exit-fullscreen') : max ? t('browse.titlebar.restore') : t('browse.titlebar.maximize');
      maximize.setAttribute('aria-label', maximize.title);
      maximize.replaceChildren(full ? icon('exitFullscreen') : h('span', { class: 'glyph-max' }));
      maximize.classList.toggle('exit-fullscreen', full);
      // A maximized or full-screen window can't be dragged out of (a slightly missed click on the bar
      // restored it): the header only moves a window that's neither. Full screen from a maximized
      // window doesn't resize it, so it's covered by the maximized check until the next sync.
      for (const region of [element, element.querySelector('.titlebar-end')]) {
        if (!region) continue;
        if (full || max) region.removeAttribute('data-tauri-drag-region');
        else region.setAttribute('data-tauri-drag-region', 'true');
      }
    });
  // Moves too: full screen to and from a maximized window keeps the page's size (the monitor's), so only the window moves.
  if (!isAndroid) {
    void win.onResized(syncMaximized);
    void win.onMoved(syncMaximized);
  }

  const element = h(
    'header',
    { class: 'titlebar', 'data-tauri-drag-region': true },
    // Not a drag region: the space around Back and the wordmark is easily hit by a slightly missed click.
    h('div', { class: 'titlebar-start' }, back, wordmark),
    options.nav,
    h(
      'div',
      { class: 'titlebar-end', 'data-tauri-drag-region': true },
      options.historyChip ?? '',
      // One group, so the Arc bar can draw them as a unit (nav-layouts.css); elsewhere it adds no box of its own.
      h('div', { class: 'titlebar-tools' }, options.profile ?? '', options.bell ?? '', settings),
      isAndroid
        ? ''
        : h(
            'div',
            { class: 'caption' },
            caption(t('browse.titlebar.minimize'), h('span', { class: 'glyph-min' }), () => win.minimize()),
            maximize,
            caption(t('browse.titlebar.close'), icon('close'), () => win.close(), 'close'),
          ),
    ),
  );

  if (!isAndroid) syncMaximized();

  return {
    element,
    update(state: { canGoBack: boolean; room: string }): void {
      back.hidden = !state.canGoBack;
      // Full screen from a maximized window doesn't resize it, so it's checked as pages change too (e.g. leaving the player).
      if (!isAndroid) syncMaximized();
      settings.classList.toggle('active', state.room === 'settings');
      // The Settings page is showing: said as well as shown.
      if (state.room === 'settings') settings.setAttribute('aria-current', 'page');
      else settings.removeAttribute('aria-current');
    },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The Orbit mark (see app-icon.svg): a ring with a moon at half past one. Same
 * proportions as the app icon; the ring takes the text colour and the moon the
 * accent, so it follows the theme and the user's accent choice. The moon sits
 * in a group around the ring's centre (0,0), so it can be set orbiting
 * (Settings → General → About); `viewBox` makes room for its whole path.
 */
export function brandMark(className = 'wordmark-mark', viewBox = '-96 -118 226 214'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('r', '78.5');
  ring.setAttribute('class', 'wordmark-ring');
  const moon = document.createElementNS(SVG_NS, 'circle');
  moon.setAttribute('cx', '102');
  moon.setAttribute('cy', '-90');
  moon.setAttribute('r', '28');
  moon.setAttribute('class', 'wordmark-moon');
  const orbit = document.createElementNS(SVG_NS, 'g');
  orbit.setAttribute('class', 'wordmark-orbit');
  orbit.append(moon);
  svg.append(ring, orbit);
  return svg;
}
