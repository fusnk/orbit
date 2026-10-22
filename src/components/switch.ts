import { h } from '../lib/dom';

/**
 * A labelled on/off switch. The whole row is one button with role="switch",
 * so it's a single focus stop and Enter/Space toggle it. Its state is its
 * `aria-checked`, so a page can redraw it after the setting changed elsewhere.
 */
export function createSwitch(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const button = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(initial) }, h('span', { class: 'switch-label' }, label), h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' })));
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  return button;
}
