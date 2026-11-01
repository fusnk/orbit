/**
 * Seasonal touches (Settings → Appearance → Little extras) around the holidays: November had
 * nothing at all (the bat went on 31 October and Thanksgiving was skipped), December only a
 * muted snowflake from the 15th. Each holiday now has a glyph in its colour, a warmer glow, its
 * films on Home after Continue Watching, holiday loading quips, and a greeting on the day.
 */
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

/** Opens the app on `date` (local time), with visual effects on so the glyph and glow show. */
async function openOn(page: Page, date: string, query = 'room=home'): Promise<void> {
  await page.clock.install({ time: new Date(date) });
  await page.goto(`/tests/ui/app.html?${query}&set.appearance={"effects":"full"}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

const rowOrder = (page: Page) => page.locator('.outlet .home-row:not([hidden])').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset['row']));

test('November is Thanksgiving: a leaf by the logo, a warmer glow and Thanksgiving films after Continue Watching', async ({ page }) => {
  await openOn(page, '2026-11-20T12:00:00');
  await expect(page.locator('html')).toHaveAttribute('data-season', 'thanksgiving');
  const mark = page.locator('.wordmark .seasonal-mark.thanksgiving');
  await expect(mark).toBeVisible();
  // In the season's colour, not the muted text grey the old glyphs used.
  const colour = await mark.evaluate((el) => getComputedStyle(el).color);
  const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted'));
  expect(colour).not.toBe(muted.trim());
  // The glow takes on the season (Home is a page with artwork, so the glow is on).
  const glow = await page.locator('.ambient').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(glow.match(/radial-gradient/g)?.length).toBe(3);

  const row = page.locator('.outlet .home-row[data-row="holiday"] .holiday-rail');
  await expect(row.locator('.rail-heading')).toHaveText('Thanksgiving films');
  await expect(row.locator('.rail-heading .seasonal-mark')).toBeVisible();
  await expect(row.locator('[data-focus-id^="poster:"]').first()).toBeVisible();
  const order = await rowOrder(page);
  expect(order.indexOf('holiday')).toBe(order.indexOf('continue') + 1);
});

test('Thanksgiving Day greets with the holiday', async ({ page }) => {
  await openOn(page, '2026-11-26T15:00:00');
  await expect(page.locator('.outlet .home-greeting')).toHaveText('Happy Thanksgiving, Sam');
});

test('December is Christmas from the 1st, with its own films', async ({ page }) => {
  await openOn(page, '2026-12-01T12:00:00');
  await expect(page.locator('html')).toHaveAttribute('data-season', 'christmas');
  await expect(page.locator('.wordmark .seasonal-mark.christmas')).toBeVisible();
  await expect(page.locator('.outlet .holiday-rail .rail-heading')).toHaveText('Christmas films');
});

test('outside the holidays there is no glyph, no seasonal glow and no holiday row', async ({ page }) => {
  await openOn(page, '2026-09-10T12:00:00');
  await expect(page.locator('html')).not.toHaveAttribute('data-season', /./);
  await expect(page.locator('.seasonal-mark')).toHaveCount(0);
  await expect(page.locator('.outlet .holiday-slot')).toBeEmpty();
});

test('turning Seasonal touches off takes the glyph, the glow and the holiday row away', async ({ page }) => {
  await openOn(page, '2026-11-20T12:00:00', 'room=home&set.fun={"seasonal":false}');
  await expect(page.locator('html')).not.toHaveAttribute('data-season', /./);
  await expect(page.locator('.seasonal-mark')).toHaveCount(0);
  await expect(page.locator('.outlet .holiday-rail')).toHaveCount(0);
});

test('a video loading in November opens on a Thanksgiving quip', async ({ page }) => {
  await openOn(page, '2026-11-20T12:00:00');
  await page.evaluate(() => window.orbitTest.openPlayer('The Last Harbor', false));
  const quip = page.locator('.player-loading-quip');
  await expect(quip).toBeVisible();
  const thanksgiving = ['Saving you the last slice of pie…', 'Loosening the belt a notch…', 'Passing the stuffing to the left…', 'Letting the turkey rest…'];
  expect(thanksgiving).toContain(await quip.textContent());
});
