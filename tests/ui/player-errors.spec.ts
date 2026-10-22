/**
 * The player when a source is dead or slow (app-fixture.ts, with mpv's events sent by hand):
 * it never sits on a spinner with no way on, and its error always offers a way out.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });
// The app starts before the player opens; the clock is jumped past the player's limits.
test.setTimeout(90_000);

/** No first frame within this long is a slow source (failover.ts START_TIMEOUT_MS). */
const SLOW_MS = 45_000;

/** Opens the app with `query` and starts playing a film; mpv has been handed the file but reported nothing yet. */
async function openLoading(page: Page, query: string): Promise<void> {
  await page.clock.install();
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(() => window.orbitTest.openPlayer('The Last Harbor', false));
}

const error = (page: Page) => page.locator('.player-error');

test('a source that never starts, with nowhere to switch to, ends in the error rather than loading forever', async ({ page }) => {
  await openLoading(page, 'set.playback.auto-switch=false');
  // (Real time also passes on the page's clock while the player opens, so this stays well short of the limit.)
  await page.clock.runFor(SLOW_MS / 2);
  await expect(error(page)).toBeHidden();
  await page.clock.runFor(SLOW_MS / 2);
  await expect(error(page)).toBeVisible();
  await expect(error(page)).toContainText('taking too long to start');
  await expect(error(page).getByRole('button', { name: 'Try another source' })).toBeVisible();
  await expect(page.locator('.player-loading .spinner')).toBeHidden();
  // It came through after all: it plays, and the error goes.
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.player.started')).toBeVisible();
  await expect(error(page)).toBeHidden();
});

test('every source slow: once the automatic tries are used up, the error shows', async ({ page }) => {
  await openLoading(page, '');
  for (let i = 0; i < 4; i++) await page.clock.runFor(SLOW_MS + 1000);
  await expect(error(page)).toBeVisible();
  await expect(error(page)).toContainText('taking too long to start');
});

test('"Try another source" closed without picking one brings the error back, not a spinner for the dead source', async ({ page }) => {
  await openLoading(page, 'set.playback.auto-switch=false');
  await page.evaluate(() => window.orbitTest.player({ kind: 'error', message: 'loading failed' }));
  await error(page).getByRole('button', { name: 'Try another source' }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-panel')).toBeHidden();
  await expect(error(page)).toBeVisible();
  await expect(error(page).getByRole('button', { name: /Try again/ })).toBeFocused();
  // Picking one plays it.
  await error(page).getByRole('button', { name: 'Try another source' }).click();
  await page.locator('.player-panel').getByText('720p · Sample Streams').click();
  await expect(error(page)).toBeHidden();
  const opened = await page.evaluate(() => window.orbitTest.calls.filter(([c]) => c === 'player_open').map(([, a]) => (a as { url: string }).url));
  expect(opened.at(-1)).toContain('720p');
});

test('a slow source that starts while "Try another source" is open: closing the list leaves the playing video alone', async ({ page }) => {
  await openLoading(page, 'set.playback.auto-switch=false');
  await page.clock.runFor(SLOW_MS + 1000);
  await expect(error(page)).toContainText('taking too long to start');
  await error(page).getByRole('button', { name: 'Try another source' }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  // It came through meanwhile.
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.player.started')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-panel')).toBeHidden();
  await expect(error(page)).toBeHidden();
  await expect(page.locator('.player-loading.failed')).toHaveCount(0);
});

test('offline mid-film: no other source is blamed, and it plays again by itself from there once the connection is back', async ({ page, context }) => {
  await page.goto('/tests/ui/app.html');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(() => window.orbitTest.openPlayer());
  const opened = () => page.evaluate(() => window.orbitTest.calls.filter(([c]) => c === 'player_open').map(([, a]) => a as { url: string; start?: number }));
  const before = await opened();
  await context.setOffline(true);
  await page.evaluate(() => window.orbitTest.player({ kind: 'error', message: 'loading failed' }));
  await expect(error(page)).toContainText('You’re offline');
  await expect(error(page)).toContainText('loads again by itself');
  expect(await opened(), 'no other source tried while offline').toHaveLength(before.length);
  await context.setOffline(false);
  await expect(error(page)).toBeHidden();
  const after = await opened();
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)?.url).toBe(before.at(-1)?.url);
  expect(after.at(-1)?.start).toBe(600);
});

test('a stream that keeps stopping early says so in the person\'s language, not the general line', async ({ page }) => {
  await page.goto('/tests/ui/app.html?lang=de&set.playback.auto-switch=false');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(() => window.orbitTest.openPlayer());
  // Ten minutes into an hour: mpv reports the end. Reopened there once; the second stop gives up.
  await page.evaluate(() => window.orbitTest.player({ kind: 'ended' }));
  await page.evaluate(() => window.orbitTest.start());
  await page.evaluate(() => window.orbitTest.player({ kind: 'ended' }));
  await expect(error(page)).toContainText('Der Stream hat vor dem Ende aufgehört');
});
