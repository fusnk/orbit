/**
 * Offline (app-fixture.ts `offline`), and the connection coming back (`orbitTest.reconnect()`).
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?offline&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

// Every rail fails together offline: the offline banner says so once, and the rows stay empty
// rather than each drawing its own error box, then come back with the connection.
test('offline rails stay quiet under the banner and come back with the connection', async ({ page }) => {
  await open(page, '');
  await page.evaluate(() => window.orbitTest.go('home'));
  expect(await page.locator('.outlet .rail-error').filter({ visible: true }).count(), 'no error box per row').toBe(0);
  const cards = () => page.locator('.outlet .home .rail .card').filter({ visible: true }).count();
  const offline = await cards();
  await page.evaluate(() => window.orbitTest.reconnect());
  await expect.poll(cards, { message: 'the rows load once the connection is back' }).toBeGreaterThan(offline);
});

// Pictures that failed offline come back with the connection: nothing redraws the hero or Continue Watching then.
test('artwork that failed offline loads once the connection is back', async ({ page }) => {
  await open(page, '');
  await page.evaluate(() => window.orbitTest.go('home'));
  const art = page.locator('.outlet .hero .hero-art.active, .outlet .continue-card .art').filter({ visible: true });
  await expect(page.locator('.outlet .hero .hero-art.active')).toHaveCount(1);
  expect(await page.locator('.outlet .hero .hero-art.loaded, .outlet .continue-card .art.loaded').count()).toBe(0);
  await page.evaluate(() => window.orbitTest.reconnect());
  await expect(page.locator('.outlet .hero .hero-art.active.loaded')).toBeVisible();
  await expect.poll(() => page.locator('.outlet .continue-card .art.loaded').count()).toBeGreaterThan(0);
  expect(await art.count()).toBeGreaterThan(1);
});

// A downloaded film's page can't load its details offline, but its saved copy still plays from there.
test("offline, a downloaded film's page still plays its copy", async ({ page }) => {
  await open(page, 'room=library');
  await page.locator('.outlet .card', { hasText: 'The Archivist' }).filter({ visible: true }).first().click();
  const failure = page.locator('.outlet .detail-failure').filter({ visible: true });
  await expect(failure).toBeVisible();
  await expect(failure.locator('button.primary')).toHaveText('Play');
  await failure.locator('button.primary').click();
  await expect.poll(() => page.evaluate(() => window.orbitTest.calls.some(([cmd]) => cmd === 'player_open'))).toBe(true);
});
