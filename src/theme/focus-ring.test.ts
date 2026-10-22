/**
 * Keyboard and pad focus stays visible on things already filled with the
 * accent (a pressed chip on Crimson, the banner's current item, the active
 * page in the menu): the accent ring vanished into them, so those get the
 * TV theme's thicker ring in the text colour, under keyboard or pad focus only.
 */
import { describe, expect, it } from 'vitest';
import styles from '../styles.css?raw';
import tokens from './tokens.css?raw';
import tv from './tv.css?raw';

const rule = (css: string, selector: string) => new RegExp(`\\n${selector.replace(/[.()*:[\]]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1];

describe('focus on accent-coloured controls', () => {
  it('is the text-coloured ring, defined once and used by TV mode', () => {
    expect(tokens).toMatch(/--focus-ring-contrast: 0 0 0 3px var\(--color-bg\), 0 0 0 6px var\(--color-text\);/);
    expect(tv).toContain('--focus-ring: var(--focus-ring-contrast);');
  });

  it('is drawn on pressed, checked and current items only under keyboard or pad focus', () => {
    const body = rule(styles, ":is([aria-pressed='true'], [aria-checked='true'], [aria-current='true']):is(:focus-visible, :root[data-input='keys'] :focus)");
    expect(body).toContain('var(--focus-ring-contrast)');
  });

  it('stays inside the active menu item, in the text colour', () => {
    const body = rule(styles, ":root:not([data-tv='on']) .nav-item.active:is(:focus-visible, :root[data-input='keys'] :focus)");
    expect(body).toMatch(/inset 0 0 0 4px var\(--color-text\)/);
  });
});
