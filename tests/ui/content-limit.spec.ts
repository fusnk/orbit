/**
 * A profile with a content limit (app-fixture.ts `profile=kids`): what the limit blocks, or can't rate because
 * TMDB's ratings can't be looked up, never shows.
 */
import { expect, test } from '@playwright/test';

for (const fault of ['', '&fail.tmdb_certifications=network']) {
  test(`Kids${fault ? ' with ratings unreachable' : ''}: Home shows no card the limit hid`, async ({ page }) => {
    await page.goto(`/tests/ui/app.html?profile=kids${fault}`);
    await page.waitForFunction(() => 'orbitTest' in window);
    expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
    // Continue Watching holds the main profile's crime shows and R-rated films (the fixture shares its history).
    const hidden = page.locator('.outlet .card[data-parental]');
    for (const card of await hidden.all()) await expect(card).toBeHidden();
    // Every Continue Watching title is blocked: the row goes, heading and all, rather than leaving a gap.
    await expect(page.locator('.outlet .rail-heading', { hasText: 'Continue Watching' })).toBeHidden();
  });
}
