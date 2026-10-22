/**
 * Layout checks for the browsing pages: Movies, TV Shows, Anime, Discover, Search,
 * My Library (and its collections) and Downloads, measured in the whole app (app-fixture.ts).
 */
import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page, query: string, size = { width: 1280, height: 1100 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

const settled = (page: Page) => page.evaluate(() => window.orbitTest.settled());

/** My Library's view called `name` (All, History, Release Radar, Stats…). */
async function libraryView(page: Page, name: RegExp): Promise<void> {
  await page.locator('.library-tabs .segment').filter({ hasText: name }).click();
  await settled(page);
}

/** Buttons on the page that still look like the browser's own (grey, with a raised 2px border). */
const browserButtons = (page: Page) =>
  page.locator('.outlet').evaluate((outlet) =>
    [...outlet.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).borderTopStyle === 'outset')
      .map((b) => b.className || b.textContent?.trim()),
  );

test.describe('no button keeps the browser’s own look', () => {
  for (const room of ['movies', 'series', 'anime', 'explore', 'search', 'library', 'downloads']) {
    test(room, async ({ page }) => {
      await openApp(page, `room=${room}`, { width: 1280, height: 4000 });
      expect(await browserButtons(page)).toEqual([]);
    });
  }

  test('Release Radar', async ({ page }) => {
    await openApp(page, 'room=library', { width: 1280, height: 3000 });
    await libraryView(page, /Release Radar/);
    await expect(page.locator('.outlet .see-all-tile').filter({ visible: true }).first()).toBeVisible();
    expect(await browserButtons(page)).toEqual([]);
  });
});

test('History lists its entries without saying nothing matches', async ({ page }) => {
  await openApp(page, 'room=library', { width: 1280, height: 2200 });
  await libraryView(page, /History/);
  await expect(page.locator('.outlet .history-entry').first()).toBeVisible();
  await expect(page.locator('.outlet').getByText('Nothing here matches these filters.')).toBeHidden();
  // …and says it once the filter leaves nothing.
  const filter = page.locator('.outlet .history .library-search').filter({ visible: true });
  await filter.click();
  await filter.pressSequentially('zzzz no such title');
  await expect(page.locator('.outlet').getByText('Nothing here matches these filters.')).toBeVisible();
});

test('Stats: every genre’s bar starts and ends in the same place', async ({ page }) => {
  await openApp(page, 'room=library', { width: 1280, height: 2200 });
  await libraryView(page, /Stats/);
  const meters = await page.locator('.outlet .stats-genre .stats-meter').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.right)]));
  expect(meters.length).toBeGreaterThan(2);
  for (const meter of meters) expect(meter).toEqual(meters[0]);
});

test('Collections: the search field is as tall as other fields', async ({ page }) => {
  await openApp(page, 'room=library');
  await page.locator('.outlet button').filter({ hasText: 'Collections' }).first().click();
  await settled(page);
  const field = page.getByPlaceholder('Find a collection');
  await expect(field).toBeVisible();
  // The control height every .text-field is given (--control-compact).
  const { height, wanted } = await field.evaluate((el) => {
    const probe = document.createElement('div');
    probe.style.height = 'var(--control-compact)';
    el.parentElement!.append(probe);
    const wanted = probe.getBoundingClientRect().height;
    probe.remove();
    return { height: el.getBoundingClientRect().height, wanted };
  });
  expect(wanted).toBeGreaterThan(20);
  expect(height).toBeCloseTo(wanted, 0);
});

test('Arabic: an English description keeps its full stop at its end', async ({ page }) => {
  await openApp(page, 'room=search&lang=ar', { width: 1280, height: 1100 });
  const input = page.locator('.outlet .search-box input');
  await input.focus();
  await input.press('Enter');
  await input.pressSequentially('harbor');
  await input.press('Enter');
  await settled(page);
  const desc = page.locator('.outlet .search-top-desc');
  await expect(desc).toBeVisible();
  // Left to right, the last character (the full stop) sits right of the one before it; read right to left it jumps to the line's left end.
  const [stop, before] = await desc.evaluate((el) => {
    const text = el.firstChild as Text;
    const n = text.length;
    const rect = (i: number) => {
      const range = document.createRange();
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      return range.getBoundingClientRect().left;
    };
    return [rect(n - 1), rect(n - 2)];
  });
  expect(stop).toBeGreaterThan(before);
});
