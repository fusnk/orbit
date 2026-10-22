/**
 * Settings → General → Updates (app-fixture.ts `updates`): what a download comes to is said on the
 * page, also when it happened while another category showed (Settings keeps each page built).
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const updates = (page: Page) => page.locator('.settings-pane .setting-row', { has: page.getByRole('button', { name: 'Check for updates' }) });

async function downloading(page: Page): Promise<void> {
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true&updates');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await updates(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(updates(page)).toContainText('Downloading Orbit 9.9.9');
}

test('a download that fails says so', async ({ page }) => {
  await downloading(page);
  await page.evaluate(() => window.orbitTest.emit('update-failed', { version: '9.9.9' }));
  await expect(updates(page)).toContainText('Couldn’t download Orbit 9.9.9');
});

test('a download that fails while another category shows is said once General shows again', async ({ page }) => {
  await downloading(page);
  await page.locator('.settings-nav-item[data-category="playback"]').click();
  await page.evaluate(() => window.orbitTest.emit('update-failed', { version: '9.9.9' }));
  await page.locator('.settings-nav-item[data-category="general"]').click();
  await expect(updates(page)).toContainText('Couldn’t download Orbit 9.9.9');
  await expect(updates(page).getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

// The line under Check for updates follows Update automatically: never "asks before installing" while it installs on quit.
test('the updates line says when Orbit installs, as Update automatically is set', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true&updates');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await expect(updates(page)).toContainText('Orbit checks once a day and asks before installing.');
  await page.getByRole('switch', { name: 'Update automatically' }).click();
  await expect(updates(page)).toContainText('Orbit checks once a day and installs an update when you quit.');
  await page.getByRole('switch', { name: 'Check for updates automatically' }).click();
  await expect(updates(page)).toContainText('Orbit checks only when you ask, and installs an update when you quit.');
});

test('with Update automatically saved on, the updates line says so from the start', async ({ page }) => {
  await page.goto(`/tests/ui/app.html?room=settings&set.settings.show-all=true&updates&set.${encodeURIComponent('updates.auto')}=true`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await expect(updates(page)).toContainText('installs an update when you quit');
});
