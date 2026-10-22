/** Small controls Theme Studio's tabs share. */
import { h } from '../../lib/dom';

/** A setting with its control under the text (the panel is narrow). */
export function field(label: string, hint: string | null, ...controls: (HTMLElement | string)[]): HTMLElement {
  return h('div', { class: 'studio-field' }, h('div', { class: 'studio-field-text' }, h('span', { class: 'studio-field-label' }, label), hint ? h('span', { class: 'studio-field-hint' }, hint) : ''), ...controls);
}

export function section(title: string, ...children: (HTMLElement | string)[]): HTMLElement {
  return h('section', { class: 'studio-section' }, h('h3', { class: 'studio-section-title' }, title), ...children);
}

/** Segmented choices; `onPick` runs only when the choice changes. */
export function segments<T>(label: string, options: readonly (readonly [T, string])[], current: T, onPick: (value: T) => void, key: string): HTMLElement {
  return h(
    'div',
    { class: 'segments studio-segments', role: 'group', 'aria-label': label },
    ...options.map(([value, text], i) => {
      const button = h('button', { class: 'segment', 'aria-pressed': String(value === current), 'data-studio-key': `${key}:${i}` }, text);
      button.addEventListener('click', () => {
        if (value !== current) onPick(value);
      });
      return button;
    }),
  );
}

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

function setAdjusting(input: HTMLElement, on: boolean): void {
  input.toggleAttribute('data-nav-arrows', !on);
  input.classList.toggle('editing', on);
}

/**
 * A slider that separates focus from editing like text fields do: reached
 * with arrow keys or a controller it's only focused, and arrows keep moving
 * focus; Enter starts adjusting it with the arrows, and Enter, Escape or
 * leaving stops. The mouse drags it any time. `onInput` runs while it moves,
 * `onChange` once it's let go.
 */
export function slider(options: { label: string; min: number; max: number; value: number; format(value: number): string; onInput(value: number): void; onChange(value: number): void; key: string }): HTMLElement {
  const input = h('input', { type: 'range', class: 'studio-slider', min: String(options.min), max: String(options.max), step: '1', value: String(options.value), 'aria-label': options.label, 'data-nav-arrows': true, 'data-studio-key': options.key });
  const readout = h('output', { class: 'studio-slider-value' }, options.format(options.value));
  const fraction = () => input.style.setProperty('--fraction', String((Number(input.value) - options.min) / (options.max - options.min)));
  fraction();
  const editing = (on: boolean) => setAdjusting(input, on);
  input.addEventListener('input', () => {
    readout.textContent = options.format(Number(input.value));
    input.setAttribute('aria-valuetext', readout.textContent);
    fraction();
    options.onInput(Number(input.value));
  });
  input.addEventListener('change', () => options.onChange(Number(input.value)));
  input.addEventListener('keydown', (event) => {
    const adjusting = !input.hasAttribute('data-nav-arrows');
    if (event.key === 'Enter') {
      event.preventDefault();
      editing(!adjusting);
    } else if (event.key === 'Escape' && adjusting) {
      event.preventDefault();
      editing(false);
    } else if (adjusting && event.key in ARROW_STEPS) {
      // Stepped here rather than left to the browser: spatial navigation takes arrows from any control that
      // isn't a field being typed in, and a controller's arrows are synthetic, which never move a slider.
      event.preventDefault();
      const rtl = getComputedStyle(input).direction === 'rtl' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      const before = input.value;
      if ((ARROW_STEPS[event.key]! > 0) !== rtl) input.stepUp();
      else input.stepDown();
      if (input.value === before) return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (!adjusting && ['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      // Not adjusting: these mustn't change the value either.
      event.preventDefault();
    }
  });
  input.addEventListener('blur', () => editing(false));
  return h('div', { class: 'studio-slider-row' }, input, readout);
}

/** A hidden file input behind a button. */
export function filePicker(accept: string, onFile: (file: File) => void): { input: HTMLInputElement; open(): void } {
  const input = h('input', { type: 'file', accept, hidden: true });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  return { input, open: () => input.click() };
}

/** Redraws `container` with `render`, keeping keyboard focus on the same control (by `data-studio-key`). */
export function redrawKeepingFocus(container: HTMLElement, render: () => void): void {
  const focused = document.activeElement;
  const key = focused instanceof HTMLElement && container.contains(focused) ? focused.dataset.studioKey : undefined;
  // A slider being adjusted stays so in its new copy: each step of its arrow keys commits, and redraws it.
  const adjusting = focused instanceof HTMLInputElement && focused.type === 'range' && !focused.hasAttribute('data-nav-arrows');
  render();
  if (!key) return;
  const again = container.querySelector<HTMLElement>(`[data-studio-key="${CSS.escape(key)}"]`);
  again?.focus({ preventScroll: true });
  if (again && adjusting) setAdjusting(again, true);
}
