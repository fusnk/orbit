/**
 * My Library, Downloads and Collections when their saved data can't be read (app-fixture.ts faults):
 * each says so with Try again, rather than looking empty; a list or collection change that isn’t saved is undone.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

const message = (page: Page) => page.locator('.outlet .state-message').filter({ visible: true });

test('watch history that can’t be read is said, not shown as nothing watched', async ({ page }) => {
  await open(page, 'room=library&fail.watch_list=error:database is locked');
  await expect(message(page)).toContainText('Couldn’t load your watch history');
  await expect(message(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a new profile whose history can’t be read isn’t welcomed as empty', async ({ page }) => {
  await open(page, 'room=library&empty-profile&fail.watch_list=error');
  await expect(message(page)).toContainText('Couldn’t load your watch history');
  await expect(page.locator('.outlet .library-welcome')).toBeHidden();
});

test('lists that can’t be read are said', async ({ page }) => {
  await open(page, 'room=library&fail.list_all=error');
  await expect(message(page)).toContainText('Couldn’t load your lists');
});

test('downloads that can’t be read keep their page, which says so', async ({ page }) => {
  await open(page, 'room=downloads&fail.download_list=error');
  await expect(page.locator('.nav-item[data-room="downloads"]')).toBeVisible();
  await expect(message(page)).toContainText('Couldn’t load your downloads');
  await expect(page.locator('.outlet .downloads-empty')).toHaveCount(0);
});

test('collections that can’t be read are said', async ({ page }) => {
  await open(page, 'room=library&fail.collection_all=error');
  await page.locator('.outlet .library-head-actions button', { hasText: 'Collections' }).click();
  await expect(message(page)).toContainText('Couldn’t load your collections');
});

test('a list switch that couldn’t be saved goes back, and says what didn’t happen', async ({ page }) => {
  await open(page, 'title=The Last Harbor&fail.list_add=error');
  await page.locator('.outlet [data-focus-id="more"]').filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Add to list…' }).click();
  const toggle = page.locator('.list-picker [role="switch"]').first();
  await toggle.click();
  await expect(page.locator('.toast')).toContainText('Couldn’t update Date night. The Last Harbor was not added.');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('history that couldn’t be removed stays in the list, so Try again can be done', async ({ page }) => {
  await open(page, 'room=library&fail.watch_remove=error');
  await page.locator('.outlet .library-tabs .segment', { hasText: 'History' }).click();
  const entries = page.locator('.outlet .history-entry');
  const before = await entries.count();
  await entries.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from history' }).click();
  await expect(page.locator('.toast')).toContainText('Couldn’t remove that from your history');
  await expect(entries).toHaveCount(before);
});

test('a collection switch that couldn’t be saved goes back', async ({ page }) => {
  await open(page, 'title=The Last Harbor&fail.collection_add=error');
  await page.locator('.outlet [data-focus-id="more"]').filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Add to collection…' }).click();
  const toggle = page.locator('.list-picker [role="switch"]').first();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});
