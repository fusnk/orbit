/**
 * The phone remote's page (src-tauri/src/remote/page) on a phone, read from
 * its stylesheet: touch targets and the screen's notches and rounded corners.
 */
import { describe, expect, it } from 'vitest';
import css from '../../src-tauri/src/remote/page/remote.css?raw';

/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector: string): string => {
  const block = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()'*]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (block === undefined) throw new Error(`${selector} not found in remote.css`);
  return block;
};

const px = (block: string, property: string): number => Number(new RegExp(`(?:^|\\s)${property}:\\s*(\\d+)px`).exec(block)?.[1] ?? NaN);

describe('phone remote page layout', () => {
  it('chips (moods, seasons) are at least 44 px tall to tap', () => {
    expect(px(rule('.chip'), 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('the tab bar keeps clear of a notch in landscape', () => {
    const tabs = rule('.tabs');
    expect(tabs).toContain('env(safe-area-inset-left)');
    expect(tabs).toContain('env(safe-area-inset-right)');
  });
});
