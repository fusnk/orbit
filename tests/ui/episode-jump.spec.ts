/**
 * A title page's "Go to episode…" field (app-fixture.ts): it's drawn anew with the episode list,
 * which redraws on its own (ratings, air times, downloads, a confirm running out), and what's typed stays.
 */
import { expect, test } from '@playwright/test';

test('what is typed in "Go to episode…" survives the episode list redrawing', async ({ page }) => {
  await page.goto(`/tests/ui/app.html?title=${encodeURIComponent('Hollow Crown Chronicles')}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  // "Mark as unwatched" asks to be pressed again, and the list redraws when the ask runs out (4 s).
  const mark = page.locator('.episodes [data-focus-id="mark-season"]');
  for (let i = 0; i < 3 && !(await mark.evaluate((b) => b.classList.contains('confirming'))); i++) await mark.click();
  await expect(mark).toHaveClass(/confirming/);
  const field = page.locator('.episodes input.episode-jump');
  await field.click();
  await page.keyboard.type('S2E');
  await expect(page.locator('.episodes [data-focus-id="mark-season"]')).not.toHaveClass(/confirming/, { timeout: 6000 });
  await expect(field).toHaveValue('S2E');
  await expect(field).toBeFocused();
  await page.keyboard.type('4');
  await expect(field).toHaveValue('S2E4');
});

test('a found episode takes focus, and the field starts empty again', async ({ page }) => {
  await page.goto(`/tests/ui/app.html?title=${encodeURIComponent('Hollow Crown Chronicles')}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  const field = page.locator('.episodes input.episode-jump');
  await field.click();
  await page.keyboard.type('S3E2');
  await page.keyboard.press('Enter');
  await expect(page.locator('.episodes [data-focus-id="ep-3-2"]')).toBeFocused();
  await expect(field).toHaveValue('');
});
