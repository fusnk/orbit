/**
 * Theme Studio (rooms/studio) in Chromium: keyboard focus through its redraws.
 */
import { expect, test, type Page } from '@playwright/test';

async function openStudio(page: Page, query = ''): Promise<void> {
  await page.goto(`/tests/ui/app.html?room=settings&set.settings.show-all=true${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.locator('.settings-nav-item[data-category="appearance"]').click();
  await page.locator('.studio-open-row button').click();
}

const focusedKey = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.studioKey ?? document.activeElement?.tagName);

test('Save pressed from the keyboard keeps the focus on it', async ({ page }) => {
  await openStudio(page);
  await page.locator('[data-studio-key="glow:3"]').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-dirty', 'true');
  await page.locator('[data-studio-key="foot:save"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.studio')).toHaveAttribute('data-dirty', 'false');
  await expect(page.locator('[data-studio-key="foot:save"]')).not.toHaveAttribute('aria-disabled', 'true');
  expect(await focusedKey(page)).toBe('foot:save');
});

test('undo and redo pressed to the end of the history hand the focus to each other', async ({ page }) => {
  await openStudio(page);
  await page.locator('[data-studio-key="glow:3"]').click();
  await page.locator('[data-studio-key="head:undo"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-studio-key="head:undo"]')).toBeDisabled();
  expect(await focusedKey(page)).toBe('head:redo');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-studio-key="head:redo"]')).toBeDisabled();
  expect(await focusedKey(page)).toBe('head:undo');
});

test('removing a seek-bar picture from the keyboard keeps the focus in the seek bar editor', async ({ page }) => {
  const bar = { style: 'flat', height: 4, color: null, barImage: 'upload-0123456789abcdef', buffered: true, bufferedBrightness: 30, dot: 'image', dotSize: 14, dotImage: 'upload-fedcba9876543210' };
  await openStudio(page, `&set.theme.seekbar=${encodeURIComponent(JSON.stringify(bar))}`);
  await page.locator('[data-studio-key="seek:barImage:remove"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-studio-key="seek:barImage:remove"]')).toBeHidden();
  expect(await focusedKey(page)).toBe('seek:barImage:choose');
  await page.locator('[data-studio-key="seek:dotImage:remove"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-studio-key="seek:dotImage:remove"]')).toHaveCount(0);
  expect(await focusedKey(page)).toBe('seek:dot:0');
});

test('Layout: moving a menu page to an end of the list keeps the keyboard focus on that page', async ({ page }) => {
  await openStudio(page);
  await page.locator('[data-studio-key="tab:layout"]').click();
  const key = (row: number, glyph: string) => page.locator(`.studio-nav-item:nth-child(${row}) [data-studio-key$=":${glyph}"]`).getAttribute('data-studio-key');
  const focused = () => focusedKey(page);

  // The second page up to the top: its up button is now disabled, so its down button takes the focus.
  const second = (await key(2, 'chevronUp'))!.replace(':chevronUp', '');
  await page.locator(`[data-studio-key="${second}:chevronUp"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.studio-nav-item:nth-child(1) [data-studio-key$=":chevronDown"]')).toHaveAttribute('data-studio-key', `${second}:chevronDown`);
  expect(await focused()).toBe(`${second}:chevronDown`);

  // The page before last down to the bottom: its up button takes the focus.
  const count = await page.locator('.studio-nav-item').count();
  const beforeLast = (await key(count - 1, 'chevronDown'))!.replace(':chevronDown', '');
  await page.locator(`[data-studio-key="${beforeLast}:chevronDown"]`).focus();
  await page.keyboard.press('Enter');
  expect(await focused()).toBe(`${beforeLast}:chevronUp`);

  // A move that doesn't reach an end keeps the focus on the same button.
  const middle = (await key(3, 'chevronUp'))!.replace(':chevronUp', '');
  await page.locator(`[data-studio-key="${middle}:chevronUp"]`).focus();
  await page.keyboard.press('Enter');
  expect(await focused()).toBe(`${middle}:chevronUp`);
});

test('nothing can be changed while a save is running, so no edit is lost when it ends', async ({ page }) => {
  await openStudio(page, '&fail.settings_set:theme.fonts=slow:3000');
  await page.locator('[data-studio-key="glow:3"]').click();
  const other = (await page.locator('[data-studio-key="glow:1"]').boundingBox())!;
  await page.locator('[data-studio-key="foot:save"]').click();
  // A click on another choice, then undo from the keyboard, while it saves (checked at once, not waited for).
  const state = () =>
    page.evaluate(() => ({
      saving: document.querySelector('[data-studio-key="foot:save"]')?.getAttribute('aria-disabled'),
      glow: [...document.querySelectorAll('[data-studio-key^="glow:"]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.getAttribute('data-studio-key'),
    }));
  await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
  expect(await state()).toEqual({ saving: 'true', glow: 'glow:3' });
  await page.keyboard.press('Control+z');
  expect(await state()).toEqual({ saving: 'true', glow: 'glow:3' });
  await expect(page.locator('[data-studio-key="foot:save"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
  await expect(page.locator('.studio')).toHaveAttribute('data-dirty', 'false');
  await expect(page.locator('[data-studio-key="glow:3"]')).toHaveAttribute('aria-pressed', 'true');
  // Editable again once it's saved.
  await page.locator('[data-studio-key="glow:1"]').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-dirty', 'true');
});

test('a slider adjusted from the keyboard takes the arrow keys until Enter again', async ({ page }) => {
  await openStudio(page);
  const height = page.locator('[data-studio-key="seek:height"]');
  await height.focus();
  const before = Number(await height.inputValue());
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focusedKey(page)).toBe('seek:height');
  expect(Number(await height.inputValue())).toBe(before + 2);
  // A controller's arrows (synthetic key events, app/gamepad.ts) adjust it the same way.
  await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(await focusedKey(page)).toBe('seek:height');
  expect(Number(await height.inputValue())).toBe(before + 1);
  await page.keyboard.press('ArrowRight');
  // Only focused again: arrows move on, as from any control.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  expect(await focusedKey(page)).not.toBe('seek:height');
  expect(Number(await height.inputValue())).toBe(before + 2);
});
