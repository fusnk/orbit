/**
 * Missing artwork (app-fixture.ts `no-art`: every picture fails, as with a dead CDN): no page shows the browser's
 * broken-image icon. A picture that fails gives way to the page's own fallback (a title card, a name, initials).
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?no-art&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

/** Pictures on screen that failed to load and are still drawn (the browser draws its broken-image icon for them). */
const broken = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => img.complete && img.naturalWidth === 0 && img.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .filter((img) => {
        const box = img.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
      })
      .map((img) => `${img.className || img.parentElement?.className}: ${img.src}`),
  );

const PAGES = ['room=home', 'room=movies', 'room=series', 'room=explore', 'room=search', 'room=library', 'room=downloads', 'room=live', 'room=addons', 'title=The Last Harbor', 'title=Blackwater County', ...['The Last Harbor', 'Blackwater County'].map((name) => `set.appearance=${encodeURIComponent('{"detailLayout":"showcase"}')}&title=${name}`)];

// Live TV's guide (its channel logos).
test('the Live TV guide: no broken-image icons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await open(page, 'room=live');
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await page.evaluate(() => window.orbitTest.settled(3000));
  await expect(page.locator('.guide-channel').first()).toBeVisible();
  expect(await broken(page)).toEqual([]);
});

// An addon's catalog preview (Addons → Details → Preview).
test("an addon's catalog preview: no broken-image icons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await open(page, 'room=addons');
  await page.getByRole('button', { name: 'Details' }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Preview' }).filter({ visible: true }).first().click();
  await expect(page.locator('.meta-card').first()).toBeVisible();
  await page.locator('.meta-grid').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.orbitTest.settled(3000));
  expect(await broken(page)).toEqual([]);
});

// Downloads whose poster wasn't saved with them fall back to the title's poster online.
test('Downloads without saved posters: no broken-image icons', async ({ page }) => {
  await open(page, 'room=downloads&fail.download_art=empty');
  await expect(page.locator('.download-poster').first()).toBeVisible();
  await page.evaluate(() => window.orbitTest.settled(3000));
  expect(await broken(page)).toEqual([]);
});

for (const query of PAGES) {
  test(`${query}: no broken-image icons`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2400 });
    await open(page, query);
    // Down the page, so lazy pictures further down are asked for too.
    for (let y = 0; y <= 6000; y += 1200) {
      await page.locator('.outlet').evaluate((el, top) => (el.scrollTop = top), y);
      await page.evaluate(() => window.orbitTest.settled(3000));
      expect(await broken(page)).toEqual([]);
    }
  });
}
