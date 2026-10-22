/** Minimal 24×24 stroke icons, built with DOM APIs (no markup parsing). */

const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape = ['path', string] | ['circle', number, number, number];

const ICONS = {
  sliders: [['path', 'M4 7h9m4 0h3M4 17h3m4 0h9'], ['circle', 15, 7, 2], ['circle', 9, 17, 2]],
  search: [['circle', 11, 11, 6.5], ['path', 'm20 20-4.2-4.2']],
  mic: [['path', 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z'], ['path', 'M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5']],
  play: [['path', 'M7.5 5v14l11.5-7z']],
  pause: [['path', 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z']],
  // Player controls.
  rewind: [['path', 'M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.5 4v4h4']],
  forward: [['path', 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4v4h-4']],
  volume: [['path', 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11']],
  volumeOff: [['path', 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5']],
  // Quieter levels: the same speaker with fewer waves.
  volumeLow: [['path', 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z']],
  volumeMid: [['path', 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6']],
  fullscreen: [['path', 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5']],
  exitFullscreen: [['path', 'M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4']],
  pip: [['path', 'M3.5 5.5h17v13h-17z'], ['path', 'M12.5 12h5.5v4h-5.5z']],
  subtitles: [['path', 'M3.5 6h17v12h-17zM7 11h4M13 11h4M7 14.5h7']],
  next: [['path', 'M5.5 5.5v13l10-6.5zM18.5 5v14']],
  shuffle: [['path', 'M4 7h3c2 0 3 1 4 2.5l2 5C14 16 15 17 17 17h3M4 17h3c1.3 0 2.2-.5 2.9-1.3M14.1 8.3C14.8 7.5 15.7 7 17 7h3M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5']],
  lock: [['path', 'M8 11V8a4 4 0 0 1 8 0v3M5.5 11h13v9h-13z']],
  pencil: [['path', 'M4.5 19.5h4l10-10-4-4-10 10zM13 7l4 4']],
  episodes: [['path', 'M7.5 4h12.5v11M4 8h12.5v12H4z']],
  speed: [['path', 'M4.5 17a8 8 0 1 1 15 0M12 16l3.5-4.5']],
  upload: [['path', 'M12 15V4.5m-4.5 4.5L12 4.5 16.5 9M4.5 15v4.5h15V15']],
  download: [['path', 'M12 4.5V15m-4.5-4.5L12 15l4.5-4.5M4.5 15v4.5h15V15']],
  folder: [['path', 'M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z']],
  trash: [['path', 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12']],
  plus: [['path', 'M12 5v14M5 12h14']],
  check: [['path', 'm5 12.5 4.5 4.5L19 7.5']],
  list: [['path', 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01']],
  back: [['path', 'M19 12H5m6-6-6 6 6 6']],
  chevronLeft: [['path', 'm15 5-7 7 7 7']],
  chevronDown: [['path', 'm6 9 6 6 6-6']],
  chevronUp: [['path', 'm6 15 6-6 6 6']],
  chevronRight: [['path', 'm9 5 7 7-7 7']],
  close: [['path', 'M6 6l12 12M18 6 6 18']],
  // Switch profile.
  swap: [['path', 'M5 8h13m-3-3 3 3-3 3M19 16H6m3-3-3 3 3 3']],
  more: [['circle', 5, 12, 1], ['circle', 12, 12, 1], ['circle', 19, 12, 1]],
  info: [['circle', 12, 12, 9], ['path', 'M12 11v5M12 8h.01']],
  // No connection (empty and error states, see state-message.ts).
  offline: [['path', 'M4 4l16 16M2.5 9a14 14 0 0 1 4.6-2.8M10.6 5.1A14 14 0 0 1 21.5 9M5.5 12.5a9 9 0 0 1 4-2.2M15.6 10.9a9 9 0 0 1 2.9 1.6M8.8 15.8a4.6 4.6 0 0 1 6.4 0M12 19.5h.01']],
  star: [['path', 'm12 4 2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z']],
  // A title page's "liked" heart (your own ratings).
  heart: [['path', 'M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6c0 5.3-7.5 9.7-7.5 9.7z']],
  // Home's "Today on Orbit" moods.
  clock: [['circle', 12, 12, 8.5], ['path', 'M12 7.5V12l3 2']],
  bell: [['path', 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0']],
  smile: [['circle', 12, 12, 8.5], ['path', 'M8.5 14a4 4 0 0 0 7 0M9.5 10h.01M14.5 10h.01']],
  gem: [['path', 'M7.5 5h9l3.5 4.5-8 9.5-8-9.5zM4 9.5h16M10 5 9 9.5l3 9.5 3-9.5-1-4.5']],
  // Home's mood chips.
  bolt: [['path', 'M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z']],
  sun: [['circle', 12, 12, 4], ['path', 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4']],
  pulse: [['path', 'M3 12h4l2.5-6 5 12 2.5-6h4']],
  ghost: [['path', 'M5.5 20V11a6.5 6.5 0 0 1 13 0v9l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6zM9.5 10.5h.01M14.5 10.5h.01']],
  spiral: [['path', 'M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 0 1 10.5 10.5a4.5 4.5 0 0 1 4.5-4.5 6 6 0 0 1 6 6 7.5 7.5 0 0 1-7.5 7.5A9 9 0 0 1 4.5 10.5']],
  globe: [['circle', 12, 12, 8.5], ['path', 'M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z']],
  // Phone remote (Ctrl+K).
  phone: [['path', 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM11 17.5h2']],
  // Tonight (Quick settings, Ctrl+K).
  moon: [['path', 'M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z']],
  // Settings categories.
  film: [['path', 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v16M16 4v16M4 12h16M4 8h4M4 16h4M16 8h4M16 16h4']],
  addons: [['path', 'M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9']],
  link: [['path', 'M10 13.5a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5M14 10.5a4.5 4.5 0 0 0-6.4-.4L5 12.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5']],
  cast: [['path', 'M3.5 9V6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19h-5.5M3.5 12.5a6.5 6.5 0 0 1 6.5 6.5M3.5 16a3 3 0 0 1 3 3M3.5 19h.01']],
  tv: [['path', 'M4 7.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V9A1.5 1.5 0 0 1 4 7.5zM16 3l-4 4.5L8 3']],
  palette: [['path', 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3.6-3.6 3.6h-1.6a1.6 1.6 0 0 0-1.1 2.7 1.6 1.6 0 0 1-1.1 2.7zM7.5 11h.01M10.5 7h.01M15 7.5h.01']],
  wrench: [['path', 'M14.5 6.5a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a5.5 5.5 0 0 1-7.3 7.3l-6.4 6.4a2 2 0 0 1-2.8-2.8l6.4-6.4a5.5 5.5 0 0 1 7.3-7.3z']],
  keyboard: [['path', 'M4 6h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 18H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 6zM6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8']],
  // Discover: its page, and liking or disliking a featured pick.
  compass: [['circle', 12, 12, 9], ['path', 'm15.5 8.5-2 5-5 2 2-5z']],
  thumbUp: [['path', 'M7 10.5v9H4.5v-9zM7 10.5l3.5-6.5a2 2 0 0 1 2.5 2l-.5 3.5h5a1.5 1.5 0 0 1 1.5 1.8l-1.3 6.5a2 2 0 0 1-2 1.7H7']],
  thumbDown: [['path', 'M7 13.5v-9H4.5v9zM7 13.5l3.5 6.5a2 2 0 0 0 2.5-2l-.5-3.5h5a1.5 1.5 0 0 0 1.5-1.8l-1.3-6.5a2 2 0 0 0-2-1.7H7']],
  // The nav's pages in the sidebar, icon rail and dock (Theme Studio → Layout).
  home: [['path', 'M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z']],
  // Theme Studio.
  undo: [['path', 'M9 14 4.5 9.5 9 5M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3']],
  redo: [['path', 'm15 14 4.5-4.5L15 5m4.5 4.5H9a4.5 4.5 0 0 0 0 9h3']],
  grip: [['circle', 9, 6.5, 1], ['circle', 15, 6.5, 1], ['circle', 9, 12, 1], ['circle', 15, 12, 1], ['circle', 9, 17.5, 1], ['circle', 15, 17.5, 1]],
  eye: [['path', 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'], ['circle', 12, 12, 3]],
  eyeOff: [['path', 'M4 4l16 16M10 5.7a8.6 8.6 0 0 1 2-.2c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a8.8 8.8 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2']],
  code: [['path', 'm8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15']],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** The icon each element was last given by `showIcon`, and which one it is. */
const shown = new WeakMap<Element, { key: string; svg: SVGSVGElement }>();

/**
 * Makes `el` show just this icon. Controls redrawn on every player status
 * (four times a second, for the whole film) keep the icon they already show,
 * rather than building a new one each time.
 */
export function showIcon(el: Element, name: IconName, options: { filled?: boolean } = {}): void {
  const key = options.filled ? `${name}:filled` : name;
  const last = shown.get(el);
  if (last?.key === key && el.childNodes.length === 1 && el.firstChild === last.svg) return;
  const svg = icon(name, options);
  shown.set(el, { key, svg });
  el.replaceChildren(svg);
}

export function icon(name: IconName, options: { filled?: boolean } = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', options.filled ? 'icon filled' : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of ICONS[name] as Shape[]) {
    const el = document.createElementNS(SVG_NS, shape[0]);
    if (shape[0] === 'path') el.setAttribute('d', shape[1]);
    else {
      el.setAttribute('cx', String(shape[1]));
      el.setAttribute('cy', String(shape[2]));
      el.setAttribute('r', String(shape[3]));
    }
    svg.append(el);
  }
  return svg;
}
