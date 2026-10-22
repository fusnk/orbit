/**
 * The "you're offline, these still play" note on Downloads is a plain note:
 * the offline banner above it already warns, and an accent tint would read
 * as an error under a red accent (Crimson).
 */
import { describe, expect, it } from 'vitest';
import css from './downloads.css?raw';

describe('the Downloads offline note', () => {
  it('is drawn on a neutral surface, not the accent or danger colour', () => {
    const rule = /\.downloads-offline \{([^}]*)\}/.exec(css)?.[1];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/--color-(accent|danger)/);
    expect(rule).toMatch(/background: var\(--color-surface/);
  });
});
