/**
 * Settings' row vocabulary: a row that offers a choice (segments, chips,
 * colour swatches, subtitle fonts) shows its current value and a chevron,
 * one focus stop; Enter or a click opens the choices in a menu, where moving
 * never picks and picking closes it (ticking boxes leaves it open). Switches
 * and sliders stay in the row: they're already one stop that acts on Enter.
 *
 * The row's own control stays in it, hidden, as the source of truth: the menu
 * presses its buttons, so every rule a panel attached (dependent rows, two
 * limits that can't cross, a setting changed elsewhere) works as it did, and
 * the value follows the control's `aria-pressed` as it changes.
 *
 * Panels draw their rows on their own, some after their settings load, so
 * `compactRows` runs over a page whenever it changes (index.ts), and a panel
 * that redraws and puts focus back by `data-focus-id` can run it first.
 */
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';

const CHOICES = '.segments[role="group"], .chips, .swatches, .subtitle-fonts';

/** The row's control if it's a set of pressable choices: its last child, or the only thing in a slot there. */
function choicesOf(row: HTMLElement): HTMLElement | null {
  let el = row.lastElementChild;
  if (el && !el.matches(CHOICES) && !el.matches('.setting-text') && el.childElementCount === 1) el = el.firstElementChild;
  if (!(el instanceof HTMLElement) || !el.matches(CHOICES) || !el.childElementCount) return null;
  // Only plain choices: a set with a colour field or an action in it stays as it is (the accent row).
  return [...el.children].every((c) => c instanceof HTMLButtonElement && c.hasAttribute('aria-pressed')) ? el : null;
}

const options = (control: HTMLElement) => [...control.children] as HTMLButtonElement[];
const nameOf = (option: HTMLElement) => option.getAttribute('aria-label') || option.textContent?.trim() || '';
const pressed = (option: HTMLElement) => option.getAttribute('aria-pressed') === 'true';

let ids = 0;

function compact(row: HTMLElement, control: HTMLElement): void {
  row.dataset.compact = '';
  control.dataset.choices = '';
  const label = control.getAttribute('aria-label') || row.querySelector('.setting-label')?.textContent || '';
  const many = control.matches('.chips');
  const text = h('span', { class: 'setting-value-text', id: `setting-value-${++ids}` });
  const dot = h('span', { class: 'setting-value-swatch', 'aria-hidden': 'true' });
  const button = h('button', { class: 'setting-value', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, 'aria-describedby': `${text.id} ${control.getAttribute('aria-describedby') ?? ''}`.trim() }, dot, text, icon('chevronRight'));
  // A panel that redraws puts focus back by these (player.ts); the value stands in for its choices.
  const focusId = control.querySelector<HTMLElement>('[data-focus-id]')?.dataset.focusId;
  if (focusId) button.dataset.focusId = `${focusId}:value`;

  const sync = () => {
    const on = options(control).filter(pressed);
    const names = on.map(nameOf);
    text.textContent = names.length ? new Intl.ListFormat(locale(), { style: 'narrow' }).format(names) : t('settingslayout.none');
    // A font shows in its own face, a colour as a dot.
    text.style.fontFamily = on.length === 1 ? on[0]!.style.fontFamily : '';
    const swatch = on.length === 1 ? on[0]!.style.getPropertyValue('--swatch') : '';
    dot.hidden = !swatch;
    dot.style.setProperty('--swatch', swatch);
  };
  new MutationObserver(sync).observe(control, { attributes: true, attributeFilter: ['aria-pressed'], subtree: true, childList: true });
  sync();

  button.addEventListener('click', () =>
    openMenuFrom(
      button,
      options(control)
        .filter((option) => !option.disabled)
        .map((option) => ({
          label: nameOf(option),
          checked: () => pressed(option),
          action: () => option.click(),
          ...(many ? { keepOpen: true } : {}),
          ...(option.style.getPropertyValue('--swatch') ? { swatch: option.style.getPropertyValue('--swatch') } : {}),
          ...(option.style.fontFamily ? { font: option.style.fontFamily } : {}),
        })),
      'end',
    ),
  );
  control.hidden = true;
  control.before(button);
}

/** Clicking a row's name or hint acts like its one control (the value, or a switch), as a TV list row does. */
function rowClicks(row: HTMLElement): void {
  if (row.dataset.rowClick !== undefined) return;
  const target = () => row.querySelector<HTMLElement>(':scope > .setting-value, :scope > * > .setting-value, :scope > [role="switch"], :scope > * > [role="switch"]:only-child');
  if (!target()) return;
  row.dataset.rowClick = '';
  row.addEventListener('click', (event) => {
    // Controls drawn under the text (the download hours) are their own: a click between their buttons isn't the row's.
    if (!(event.target as Element).closest('.setting-text') || (event.target as Element).closest('a, button, input, [role="group"]')) return;
    target()?.click();
  });
}

/** Gives every choice row in `root` its value button (once), and makes rows with one control clickable as a whole. */
export function compactRows(root: HTMLElement): void {
  for (const row of root.querySelectorAll<HTMLElement>('.setting-row')) {
    const control = choicesOf(row);
    if (control && control.dataset.choices === undefined) compact(row, control);
    rowClicks(row);
    // A hint shows one line until its row has focus (settings.css); a pointer can read the rest here.
    for (const hint of row.querySelectorAll<HTMLElement>(':scope > .setting-text > .setting-hint')) if (hint.title !== hint.textContent) hint.title = hint.textContent ?? '';
  }
}
