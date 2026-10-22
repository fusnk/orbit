import { decodeEntities } from '../../addons/schema';
import { onBack } from '../../app/back';
import { fallbackHue } from '../../catalog/titles';
import { withHue } from '../../components/cards';
import { icon } from '../../components/icons';
import { pushLayer } from '../../components/layers';
import { placeMenu } from '../../components/menu';
import { isRtl, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { addRecentGenre, DEFAULT_RECENT_GENRES, parseRecentGenres } from '../../lib/recent-genres';
import { profileSetting } from '../../library/profiles';
import './genre-picker.css';

export interface GenreFilter {
  /** The catalog's options; empty hides the picker (no genre extra, or a page locked to one genre). */
  options: readonly string[];
  /** Whether "All genres" can be chosen (false for a catalog that requires a value). */
  allowAll: boolean;
  current: string | undefined;
  pick(value: string | undefined): void;
}

/** Cinemeta's "New" catalog filters by year through its genre extra. */
const isYears = (options: readonly string[]) => options.length > 0 && options.every((o) => /^\d{4}$/.test(o));

// The genres picked last, per profile; shared by Movies and TV Shows.
// (Switching profiles reloads the app, so loading once is enough.)
const RECENT_PREFIX = 'discover.recent-genres';
let recent: string[] = [...DEFAULT_RECENT_GENRES];
const redraws = new Set<() => void>();
let savedRecent: Promise<string> | undefined;

function loadRecent(): void {
  savedRecent ??= profileSetting(RECENT_PREFIX).then(({ key, value }) => {
    recent = parseRecentGenres(value);
    for (const redraw of redraws) redraw();
    return key;
  });
  savedRecent.catch((err: unknown) => console.warn('Could not load recent genres', err));
}

function remember(genre: string): void {
  const next = addRecentGenre(recent, genre);
  if (next.join() === recent.join()) return;
  recent = next;
  void savedRecent?.then((key) => settings.set(key, recent)).catch((err: unknown) => console.warn('Could not save recent genres', err));
}

/**
 * The genre filter of Movies / TV Shows: a button naming the current genre,
 * which opens a panel of genre tiles, and the last few genres picked as
 * one-click shortcuts beside it.
 */
export function createGenrePicker() {
  let filter: GenreFilter = { options: [], allowAll: false, current: undefined, pick: () => {} };
  const groupLabel = () => (isYears(filter.options) ? t('browse.discover.year') : t('browse.service.genre'));

  const value = h('span', { class: 'genre-pick-value' });
  const button = h('button', { class: 'genre-pick', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, value, icon('chevronDown'));
  const shortcuts = h('div', { class: 'genre-shortcuts', role: 'group', 'aria-label': t('browse.discover.genre-recent') });
  const element = h('div', { class: 'genre-picker' }, button, shortcuts);
  button.addEventListener('click', () => openPanel());

  function choose(genre: string | undefined): void {
    if (genre !== undefined && !isYears(filter.options)) remember(genre);
    filter.pick(genre);
  }

  function shortcut(genre: string): HTMLElement {
    const chip = h('button', { class: 'genre-shortcut', 'aria-pressed': String(filter.current === genre) }, decodeEntities(genre));
    chip.addEventListener('click', () => {
      choose(genre);
      // The shortcuts were redrawn (and reordered): the keyboard stays on the genre just chosen.
      [...shortcuts.querySelectorAll<HTMLElement>('.genre-shortcut')].find((other) => other.textContent === decodeEntities(genre))?.focus({ preventScroll: true });
    });
    return chip;
  }

  function openPanel(): void {
    const years = isYears(filter.options);
    const tile = (label: string, genre: string | undefined) => {
      const chosen = filter.current === genre;
      const tileButton = h('button', { class: `genre-option${genre === undefined ? ' all' : ''}`, 'aria-pressed': String(chosen) }, h('span', { class: 'genre-option-name' }, label), chosen ? icon('check') : '');
      if (genre !== undefined && !years) withHue(tileButton, fallbackHue(genre));
      tileButton.addEventListener('click', () => {
        close();
        choose(genre);
      });
      return tileButton;
    };
    const tiles = [...(filter.allowAll ? [tile(t('browse.discover.genre-any'), undefined)] : []), ...filter.options.map((o) => tile(decodeEntities(o), o))];
    const panel = h('div', { class: 'genre-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': groupLabel() }, h('div', { class: `genre-panel-grid${years ? ' years' : ''}` }, ...tiles));

    // Like the ⋯ menu: a modal layer that Back, a click outside or a choice closes, returning focus to the button.
    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      removeBack();
      removeLayer();
      document.removeEventListener('pointerdown', onOutside, true);
      panel.remove();
      button.setAttribute('aria-expanded', 'false');
      if (button.isConnected) button.focus({ preventScroll: true });
    }
    const removeBack = onBack(close);
    const onOutside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onOutside, true);

    document.body.append(panel);
    const { width, height } = panel.getBoundingClientRect();
    const at = placeMenu(button.getBoundingClientRect(), 8, { width, height }, { width: innerWidth, height: innerHeight }, isRtl());
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
    const removeLayer = pushLayer(panel, close);
    button.setAttribute('aria-expanded', 'true');
    (tiles.find((b) => b.getAttribute('aria-pressed') === 'true') ?? tiles[0])?.focus();
  }

  function render(next: GenreFilter = filter): void {
    filter = next;
    const { options, current } = filter;
    element.hidden = options.length === 0;
    value.textContent = current !== undefined ? decodeEntities(current) : t('browse.discover.genre-any');
    button.title = groupLabel();
    const shown = isYears(options) ? [] : recent.filter((g) => options.includes(g));
    shortcuts.replaceChildren(...shown.map(shortcut));
    fitShortcuts();
  }

  /**
   * Only the recent genres that fit whole show: one cut by the edge lost its end, its hover pill and its
   * focus ring, and the keyboard could still stop on it. The rest are hidden, so it can't stop on them.
   */
  function fitShortcuts(): void {
    const chips = [...shortcuts.children] as HTMLElement[];
    for (const chip of chips) chip.hidden = false;
    const box = shortcuts.getBoundingClientRect();
    const style = getComputedStyle(shortcuts);
    const start = box.left + parseFloat(style.paddingLeft);
    const end = box.right - parseFloat(style.paddingRight);
    let out = false;
    for (const chip of chips) {
      const r = chip.getBoundingClientRect();
      out ||= r.left < start - 0.5 || r.right > end + 0.5;
      chip.hidden = out;
    }
  }
  new ResizeObserver(fitShortcuts).observe(shortcuts);

  // Wrapped onto a line of its own (discover.css), the picker has nothing before it to divide from
  // (genre-picker.css; unless its hairline is already left out, with no catalog tabs before it).
  new ResizeObserver(() => {
    const row = element.parentElement;
    if (!row) return;
    const at = element.getBoundingClientRect();
    const edge = row.getBoundingClientRect();
    const first = isRtl() ? edge.right - at.right < 1 : at.left - edge.left < 1;
    element.classList.toggle('leads', first && getComputedStyle(element, '::before').display !== 'none');
  }).observe(element);

  redraws.add(() => render());
  loadRecent();
  return { element, render };
}
