/**
 * Theme Studio → Code: custom CSS in a plain editor, applied a moment after
 * typing stops, and a cheat sheet of the class names Orbit keeps stable for
 * themes and its colour variables. CSS only (see theme/custom-css.ts).
 *
 * Like text fields, the editor separates focus from editing: reached with
 * the keyboard or a controller it's only focused (arrow keys keep moving
 * around); Enter or a click starts editing, and Escape stops. While editing,
 * Tab indents instead of leaving.
 */
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { cleanCss, CSS_MAX_BYTES, cssBytes, cssFits } from '../../theme/custom-css';
import type { Look } from '../../theme/engine';
import { section } from './controls';
import type { Change } from './look-tab';

const APPLY_MS = 300;
const INDENT = '  ';

const CHEAT_SHEET: [MessageKey, string[]][] = [
  ['studio.cheat.nav', ['.titlebar', '.nav', '.nav-item', '.nav-item.active', '.nav-indicator', '.nav-label', '.wordmark']],
  ['studio.cheat.cards', ['.card', '.poster-card', '.poster-frame', '.continue-card', '.card-title', '.card-sub']],
  ['studio.cheat.rows', ['.rail', '.rail-header', '.rail-heading', '.rail-track']],
  ['studio.cheat.hero', ['.hero', '.hero-title', '.hero-meta', '.hero-actions']],
  ['studio.cheat.title', ['.detail', '.detail-hero', '.detail-lower', '.detail-cast']],
  ['studio.cheat.player', ['.player-ui', '.player-bar', '.player-button', '.player-time', '.player-title']],
  ['studio.cheat.seek', ['.seek', '.seek-track', '.seek-fill', '.seek-buffered', '.seek-knob']],
  [
    'studio.cheat.variables',
    ['--color-bg', '--color-panel', '--color-panel-2', '--color-text', '--color-text-muted', '--color-text-faint', '--color-accent', '--color-danger', '--font-ui', '--font-display', '--radius-card', '--poster-width', '--seek-height', '--seek-bar'],
  ],
];

/** The Code tab; `flush` applies an edit still waiting for typing to stop (before closing, saving, undo…). */
export function codeTab(look: Look, change: Change): { element: HTMLElement; flush(): void } {
  const editor = h('textarea', {
    class: 'studio-css',
    'aria-label': t('studio.code.label'),
    placeholder: '.poster-card {\n  border-radius: 0;\n}',
    spellcheck: 'false',
    autocomplete: 'off',
    wrap: 'off',
    readonly: true,
    'data-nav-arrows': true,
    'data-studio-key': 'css',
  });
  editor.value = look.css;
  const count = h('span', { class: 'studio-css-count', 'aria-live': 'polite' });
  const kb = (bytes: number) => new Intl.NumberFormat(locale(), bytes < 1024 ? { style: 'unit', unit: 'byte' } : { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 }).format(bytes < 1024 ? bytes : bytes / 1024);

  const editing = (on: boolean) => {
    editor.readOnly = !on;
    editor.toggleAttribute('data-nav-arrows', !on);
    editor.classList.toggle('editing', on);
  };

  let timer: number | undefined;
  /** Applies the edit waiting on `timer`, if any. */
  let pending: (() => void) | undefined;
  function showCount(text: string): boolean {
    const fits = cssFits(text);
    count.textContent = fits ? t('studio.code.count', { chars: text.length, size: kb(cssBytes(text)), max: kb(CSS_MAX_BYTES) }) : t('studio.code.too-large', { max: kb(CSS_MAX_BYTES) });
    count.classList.toggle('over', !fits);
    return fits;
  }
  showCount(look.css);

  editor.addEventListener('input', () => {
    window.clearTimeout(timer);
    pending = undefined;
    const text = cleanCss(editor.value);
    if (!showCount(text)) return;
    pending = () => {
      window.clearTimeout(timer);
      pending = undefined;
      look = { ...look, css: text };
      change(look, { group: 'css', redraw: false });
    };
    timer = window.setTimeout(pending, APPLY_MS);
  });
  editor.addEventListener('pointerdown', () => editing(true));
  editor.addEventListener('blur', () => editing(false));
  editor.addEventListener('keydown', (event) => {
    if (editor.readOnly) {
      if (event.key === 'Enter') {
        event.preventDefault();
        editing(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      editing(false);
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (event.shiftKey) return outdent();
      // execCommand keeps the field's own undo working; setRangeText is the fallback.
      if (!document.execCommand('insertText', false, INDENT)) {
        editor.setRangeText(INDENT, editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input'));
      }
    }
  });

  /** Shift+Tab: takes one indent off the start of the caret's line. */
  function outdent(): void {
    const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    if (!editor.value.startsWith(INDENT, start)) return;
    const caret = editor.selectionStart;
    editor.setRangeText('', start, start + INDENT.length, 'preserve');
    editor.setSelectionRange(Math.max(start, caret - INDENT.length), Math.max(start, caret - INDENT.length));
    editor.dispatchEvent(new Event('input'));
  }

  const clear = h('button', { class: 'button', 'data-studio-key': 'css:clear' }, t('studio.code.clear'));
  clear.addEventListener('click', () => {
    window.clearTimeout(timer);
    pending = undefined;
    change({ ...look, css: '' });
  });

  const element = h(
    'div',
    { class: 'studio-tab' },
    section(t('studio.code.heading'), h('p', { class: 'studio-field-hint' }, t('studio.code.hint')), editor, h('div', { class: 'studio-css-footer' }, h('span', { class: 'studio-field-hint' }, t('studio.code.edit-hint')), count), h('div', { class: 'studio-inline' }, clear)),
    section(
      t('studio.cheat.heading'),
      h('p', { class: 'studio-field-hint' }, t('studio.cheat.hint')),
      h('dl', { class: 'studio-cheats' }, ...CHEAT_SHEET.flatMap(([title, names]) => [h('dt', {}, t(title)), h('dd', {}, ...names.map((name) => h('code', { class: 'selectable' }, name)))])),
    ),
  );
  return { element, flush: () => pending?.() };
}
