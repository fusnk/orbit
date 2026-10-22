/**
 * TMDB (and the other metadata services) failing while addons work (app-fixture.ts "Faults"):
 * the pages stay usable and say what happened in words a person can act on.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

// A TMDB key that TMDB stopped accepting (revoked or regenerated): Retry can't bring its rows back, Settings can.
test("TMDB's rows offer Fix in Settings once TMDB rejects the saved key", async ({ page }) => {
  await open(page, 'fail.tmdb_*=http:401');
  const failed = page.locator('.outlet .rail-error').filter({ visible: true });
  await expect(failed.first()).toBeVisible();
  for (const box of await failed.all()) {
    await expect(box.getByRole('button', { name: 'Fix in Settings' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  }
  await failed.first().getByRole('button', { name: 'Fix in Settings' }).click();
  await expect(page.locator('.tmdb-row').filter({ visible: true })).toBeVisible();
});

// TMDB unreachable while the token is saved: Discover's TMDB rows fail (with Retry), they don't ask to connect TMDB.
for (const fault of ['fail.tmdb_*=network', 'offline']) {
  test(`${fault}: Discover doesn't ask to connect a TMDB that is connected`, async ({ page }) => {
    await open(page, `room=explore&${fault}`);
    await expect(page.getByText('Connect TMDB to discover more')).toHaveCount(0);
  });
}
