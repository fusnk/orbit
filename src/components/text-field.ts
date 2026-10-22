import { h } from '../lib/dom';

function setEditing(input: HTMLInputElement, editing: boolean): void {
  input.readOnly = !editing;
  input.classList.toggle('editing', editing);
}

/**
 * Focuses a field and starts editing it, for when the user explicitly asked
 * to type there (e.g. choosing Search or pressing Ctrl+K), which counts as
 * activation.
 */
export function beginEditing(input: HTMLInputElement): void {
  setEditing(input, true);
  input.focus({ preventScroll: true });
}

/** Where typing was in `input` (its selection), or null when it isn't being typed in. */
export function editingAt(input: HTMLInputElement): { start: number | null; end: number | null } | null {
  return input.readOnly ? null : { start: input.selectionStart, end: input.selectionEnd };
}

/**
 * Goes on typing in a redrawn copy of a field, where `editingAt` found the
 * typing in the old one: the person was already editing, so this isn't a new activation.
 */
export function resumeEditing(input: HTMLInputElement, at: { start: number | null; end: number | null }): void {
  beginEditing(input);
  if (at.start !== null) input.setSelectionRange(at.start, at.end ?? at.start);
}

/**
 * A text input that separates focus from editing: reaching it with Tab or a
 * controller only focuses it; Enter or a click starts editing, Enter again
 * submits, and Escape or leaving the field stops editing.
 */
export function createTextField(options: { label: string; placeholder?: string; onSubmit(value: string): void; className?: string }) {
  const input = h('input', {
    class: `text-field ${options.className ?? ''}`.trim(),
    type: 'text',
    'aria-label': options.label,
    placeholder: options.placeholder ?? '',
    autocomplete: 'off',
    spellcheck: 'false',
    readonly: true,
  });

  input.addEventListener('pointerdown', () => setEditing(input, true));
  input.addEventListener('blur', () => setEditing(input, false));
  input.addEventListener('keydown', (event) => {
    // Enter and Esc while an input method (Chinese, Japanese, Korean) is composing belong to it, as in the palette.
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (input.readOnly) setEditing(input, true);
      else options.onSubmit(input.value);
    } else if (event.key === 'Escape' && !input.readOnly) {
      event.preventDefault();
      setEditing(input, false);
    }
  });

  return input;
}
