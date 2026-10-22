/**
 * The Next Up bridge (next-up-bridge.ts) in the whole app: Play now on the
 * Next Up card covers the hand-off with the next episode's still, which
 * dissolves once that episode shows its first frame; with Reduce motion on,
 * the loading screen shows as before.
 */
import { expect, test, type Page } from '@playwright/test';

async function openNearTheEnd(page: Page, query = ''): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  await page.evaluate(() => window.orbitTest.openPlayer('Blackwater County'));
  await page.evaluate(() => window.orbitTest.status({ timePos: 3570 }));
  await expect(page.locator('.next-up:not([hidden])')).toHaveCount(1);
}

/** The next file asked to open (`player_open`), as the fixture numbers it. */
const opened = (page: Page) => page.evaluate(() => window.orbitTest.calls.filter(([cmd]) => cmd === 'player_open').length);

test('Play now eases into the next episode and dissolves once it shows', async ({ page }) => {
  await openNearTheEnd(page);
  const before = await opened(page);
  await page.locator('.next-up .button.primary').click();
  const bridge = page.locator('.next-up-bridge.on');
  await expect(bridge).toHaveCount(1);
  await expect(bridge.locator('.next-up-bridge-episode')).toContainText('S');
  // The next episode is opened at once, not after the transition.
  await expect.poll(() => opened(page)).toBeGreaterThan(before);
  await expect(page.locator('.player.bridging')).toHaveCount(1);
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.next-up-bridge.leaving, .next-up-bridge.on')).toHaveCount(1);
  await expect(page.locator('.next-up-bridge.on, .next-up-bridge.leaving')).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('.player.bridging')).toHaveCount(0);
});

test('with Reduce motion on, the hand-off shows the loading screen as before', async ({ page }) => {
  await openNearTheEnd(page, 'set.appearance={"motion":"reduce"}');
  await page.locator('.next-up .button.primary').click();
  await expect(page.locator('.player:not(.started) .player-loading')).toBeVisible();
  await expect(page.locator('.next-up-bridge.on')).toHaveCount(0);
});
