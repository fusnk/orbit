/**
 * An episode still to come fades its picture, not its words: a row at 55%
 * opacity left "Airs Oct 25" and the title at about 2:1 contrast.
 */
import { describe, expect, it } from 'vitest';
import css from './detail.css?raw';

const rule = (selector: string) => new RegExp(`${selector.replace(/[.()*:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1];

describe('an unaired episode row', () => {
  it('does not fade the whole row', () => {
    expect(rule('.episode-row.unaired')).toBeDefined();
    expect(rule('.episode-row.unaired')).not.toContain('opacity');
  });

  it('fades only its still, and keeps its text at the muted colour', () => {
    expect(rule('.episode-row.unaired .episode-still')).toContain('opacity');
    expect(rule('.episode-row.unaired :is(.episode-title, .episode-meta)')).toContain('var(--color-text-muted)');
  });
});
