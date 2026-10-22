/**
 * Downloads (app-fixture.ts sample downloads): a saved film sits under its own name once.
 */
import { expect, test } from '@playwright/test';

test("a saved film's name shows once, its row giving just the quality and size", async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=downloads');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  const group = page.locator('.outlet .download-group', { hasText: 'The Archivist' });
  await expect(group.locator('.download-group-title')).toHaveText('The Archivist');
  await expect(group.locator('.download-saved .download-name')).toHaveCount(0);
  await expect(group.locator('.download-saved .download-sub')).toContainText('1080p');
});
