import { h } from '../lib/dom';
import './slider.css';

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  /** One arrow press; Page Up/Down move ten of them. */
  step?: number;
  /** How the value reads, e.g. "+12". */
  format?: (value: number) => string;
  /** Tags the slider so focus survives a redraw. */
  focusId?: string;
  /** Every change, while dragging or adjusting. */
  onInput(value: number): void;
}

/**
 * A labelled slider that keeps focus and activation apart (docs/DEVELOPMENT.md):
 * focused, arrow keys move between controls like anywhere else; Enter or
 * Space starts adjusting it (←/→, Page Up/Down, Home/End), and Enter, Space,
 * Escape, ↑/↓ or leaving it stop. A pointer drags it directly. Not an
 * `<input type="range">`, which takes the arrow keys as soon as it's focused.
 */
export function createSlider(options: SliderOptions): HTMLElement & { setValue(value: number): void } {
  const step = options.step ?? 1;
  const format = options.format ?? String;
  let value = options.value;

  const fill = h('span', { class: 'slider-fill' });
  const knob = h('span', { class: 'slider-knob' });
  const track = h('span', { class: 'slider-track', 'aria-hidden': 'true' }, fill, knob);
  const output = h('span', { class: 'slider-value', 'aria-hidden': 'true' });
  const thumb = h(
    'div',
    {
      class: 'slider-control',
      role: 'slider',
      tabindex: '0',
      // The track runs left to right in every language, like the player's.
      dir: 'ltr',
      'aria-label': options.label,
      'aria-valuemin': String(options.min),
      'aria-valuemax': String(options.max),
      ...(options.focusId ? { 'data-focus-id': options.focusId } : {}),
    },
    track,
  );
  const root = h('div', { class: 'slider' }, h('span', { class: 'slider-label', 'aria-hidden': 'true' }, options.label), thumb, output) as unknown as HTMLElement & { setValue(value: number): void };

  function draw(): void {
    // The fill grows from 0 when the range spans it (−100..100), else from the start.
    const span = options.max - options.min;
    const at = (value - options.min) / span;
    const zero = options.min < 0 && options.max > 0 ? -options.min / span : 0;
    thumb.style.setProperty('--at', String(at));
    fill.style.setProperty('--from', String(Math.min(zero, at)));
    fill.style.setProperty('--to', String(Math.max(zero, at)));
    thumb.setAttribute('aria-valuenow', String(value));
    thumb.setAttribute('aria-valuetext', format(value));
    output.textContent = format(value);
  }

  function set(next: number): void {
    const clamped = Math.max(options.min, Math.min(options.max, Math.round(next / step) * step));
    if (clamped === value) return;
    value = clamped;
    draw();
    options.onInput(value);
  }

  const adjusting = () => thumb.dataset.adjusting === 'true';
  function setAdjusting(on: boolean): void {
    if (on) thumb.dataset.adjusting = 'true';
    else delete thumb.dataset.adjusting;
  }

  thumb.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'Enter' || event.key === ' ') {
      claim();
      if (!event.repeat) setAdjusting(!adjusting());
      return;
    }
    if (!adjusting()) return;
    switch (event.key) {
      case 'Escape':
        claim();
        setAdjusting(false);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        // Done here: the arrow moves on, as it would without adjusting.
        setAdjusting(false);
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        claim();
        set(value + (event.key === 'ArrowRight' ? step : -step));
        return;
      }
      case 'PageUp':
      case 'PageDown':
        claim();
        set(value + (event.key === 'PageUp' ? 10 * step : -10 * step));
        return;
      case 'Home':
      case 'End':
        claim();
        set(event.key === 'End' ? options.max : options.min);
        return;
    }
  });
  thumb.addEventListener('blur', () => setAdjusting(false));

  const fromPointer = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;
    const at = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    set(options.min + at * (options.max - options.min));
  };
  thumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    thumb.setPointerCapture(event.pointerId);
    fromPointer(event);
  });
  thumb.addEventListener('pointermove', (event) => {
    if (thumb.hasPointerCapture(event.pointerId)) fromPointer(event);
  });
  // A double-click puts it back to 0 (or the start), as in photo editors.
  thumb.addEventListener('dblclick', () => set(options.min < 0 && options.max > 0 ? 0 : options.min));

  root.setValue = (next: number) => {
    value = Math.max(options.min, Math.min(options.max, next));
    draw();
  };
  draw();
  return root;
}
