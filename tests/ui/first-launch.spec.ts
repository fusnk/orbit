/**
 * A brand-new install (app-fixture.ts `new-install`): first-run setup, then the pages a person
 * with no addons of their own, no TMDB key and no Live TV source sees, online and offline.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/tests/ui/app.html?new-install&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

for (const query of ['', 'offline']) {
  test(`${query || 'online'}: setup opens on a new install, and skipping it starts Getting started`, async ({ page }) => {
    await open(page, query);
    await expect(page.locator('.onboard')).toBeVisible();
    await page.locator('.onboard-skip').click();
    await expect(page.locator('.onboard')).toHaveCount(0);
    await expect(page.locator('.checklist').filter({ visible: true })).toBeVisible();
  });
}

// The built-ins (Cinemeta, OpenSubtitles) are installed on the first launch, which can't happen offline:
// Home said "Enable Cinemeta" for an addon that wasn't there, rather than that it loads once back online.
test('offline: Home says it loads once back online, inside the gutter and under the greeting', async ({ page }) => {
  await open(page, 'offline&set.onboarding.done=true');
  const box = page.locator('.home-rails > .state-message');
  await expect(box).toContainText('You’re offline');
  await expect(box.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('.home').getByText('Enable Cinemeta')).toHaveCount(0);
  const [banner, greeting, message] = await Promise.all(['#app > .offline-banner:not(.update-banner)', '.home-greeting', '.home-rails > .state-message'].map((s) => page.locator(s).boundingBox()));
  // The greeting starts below the offline banner, not under it.
  expect(greeting!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height);
  // The box lines up with the banner (the page's gutter), not the window's edges.
  expect(message!.x).toBeCloseTo(banner!.x, 0);
  expect(message!.x + message!.width).toBeCloseTo(banner!.x + banner!.width, 0);
});

for (const room of ['movies', 'series']) {
  test(`offline: ${room} shows why there's nothing, without an empty banner or filter bar`, async ({ page }) => {
    await open(page, `offline&set.onboarding.done=true&room=${room}`);
    const discover = page.locator('.discover').filter({ visible: true });
    await expect(discover.locator('.state-message')).toContainText('You’re offline');
    await expect(discover.locator('.featured')).toBeHidden();
    await expect(discover.locator('.discover-bar')).toBeHidden();
  });
}

test('Live TV without a source: "No TV provider yet" takes the page width', async ({ page }) => {
  await open(page, 'set.onboarding.done=true&room=live');
  const message = page.locator('.live-body > .state-message');
  await expect(message).toContainText('No TV provider yet');
  expect((await message.boundingBox())!.width).toBeGreaterThan(800);
});

test('900px: Getting started keeps its dismiss button in the corner', async ({ page }) => {
  await open(page, '');
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator('.onboard-skip').click();
  const card = page.locator('.checklist').filter({ visible: true });
  await expect(card).toBeVisible();
  const [box, dismiss] = await Promise.all([card.boundingBox(), card.locator('.welcome-dismiss').boundingBox()]);
  expect(box!.x + box!.width - (dismiss!.x + dismiss!.width)).toBeLessThan(40);
});
