/**
 * Finding sources from a title's page (app-fixture.ts) when the stream addon answers badly: the source list
 * always ends on a state that says what happened and offers the way on, never a bare line or a spinner.
 */
import { expect, test, type Page } from '@playwright/test';

/** Opens The Last Harbor's page with `query`, then the source list (Play set to "Let me choose"). */
async function openSources(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/tests/ui/app.html?title=${encodeURIComponent('The Last Harbor')}&set.playback.play="choose"&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  await page.locator('.outlet [data-focus-id="play"]').filter({ visible: true }).first().click();
  await expect(page.locator('.picker .picker-footer')).toBeVisible();
  await expect(page.locator('.picker .provider.pending')).toHaveCount(0);
}

// The whole app loads for each test, and the sources are asked for first: slower than one page.
test.describe.configure({ timeout: 90_000 });

const state = (page: Page) => page.locator('.picker .picker-empty');

test('an addon with nothing for the title: a "nothing to play" state that leads to installing another addon', async ({ page }) => {
  await openSources(page, 'fail.addon_request:sample-streams=empty');
  await expect(state(page).locator('.picker-empty-title')).toHaveText('Nothing to play yet');
  await expect(state(page).getByRole('button', { name: 'Install an addon' })).toBeFocused();
  // Quality filters have nothing to filter.
  await expect(page.locator('.picker .picker-filters')).toHaveCount(0);
});

test('only torrents while torrents are off: says so, and leads to the torrent setting', async ({ page }) => {
  await openSources(page, 'streams=torrents');
  await expect(state(page).locator('.picker-empty-title')).toHaveText('Only torrents found');
  await state(page).getByRole('button', { name: 'Open torrent settings' }).click();
  await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.nav-item[data-room="settings"], .settings').first()).toBeVisible();
});

test('an addon refusing the request: Fix in Settings rather than "try again"', async ({ page }) => {
  await openSources(page, 'fail.addon_request:sample-streams=http:403');
  await expect(state(page).getByRole('button', { name: 'Fix in Settings' })).toBeFocused();
  await expect(page.locator('.picker .provider.failed')).toHaveText(/refused the request/);
});

for (const mode of ['timeout', 'rate-limited', 'junk']) {
  test(`an addon failing (${mode}): Try again, focused`, async ({ page }) => {
    await openSources(page, `fail.addon_request:sample-streams=${mode}`);
    await expect(state(page).getByRole('button', { name: 'Try again' })).toBeFocused();
    await expect(page.locator('.picker .provider.failed')).not.toHaveText(/· failed$/);
  });
}
