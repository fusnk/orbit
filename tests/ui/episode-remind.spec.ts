/**
 * "Remind me" on a title page's upcoming episodes (app-fixture.ts): the reminder is the show's, so every bell says so.
 */
import { expect, test } from '@playwright/test';

test('a reminder set from one upcoming episode lights the other episodes’ bells', async ({ page }) => {
  await page.goto(`/tests/ui/app.html?title=${encodeURIComponent('Blackwater County')}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  const bells = page.locator('.episodes .episode-remind');
  await expect(bells).toHaveCount(2);
  await expect(bells.nth(1)).not.toHaveClass(/\bon\b/);
  await bells.first().click();
  await page.locator('.menu .menu-item').first().click();
  await expect(bells.first()).toHaveClass(/\bon\b/);
  await expect(bells.nth(1)).toHaveClass(/\bon\b/);
});
