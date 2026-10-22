/**
 * A profile's content limit in Chromium (app-fixture.ts): on the sample Kids profile, whose
 * limit shows only young kids' ratings, what My Library lists from the watch history.
 */
import { expect, test, type Page } from '@playwright/test';

async function kidsLibrary(page: Page): Promise<void> {
  await page.goto('/tests/ui/app.html?room=library&profile=kids');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
}

/** My Library's tab named `label`. */
const tab = (page: Page, label: string) => page.locator('.segment', { hasText: label }).first();

test('Stats lists only top shows the limit allows', async ({ page }) => {
  await kidsLibrary(page);
  await tab(page, 'Stats').click();
  await expect(page.locator('.stats')).toBeVisible();
  // The sample history's shows are all rated above Kids (TV-14, TV-MA).
  await expect(page.locator('.stats-show')).toHaveCount(0);
});

// Every favourite is of a show the limit blocks: the tab counts none of them, so it isn't offered at all
// (as any tab with nothing to list), rather than opening on an empty list.
test('Favourite episodes leaves out shows the limit blocks', async ({ page }) => {
  await kidsLibrary(page);
  await expect(tab(page, 'Stats')).toBeVisible();
  await expect(page.locator('.segment', { hasText: 'Favourite episodes' })).toHaveCount(0);
  await expect(page.locator('.fav-episodes-show')).toHaveCount(0);
});
