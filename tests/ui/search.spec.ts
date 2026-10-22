/**
 * Search in the whole app (app-fixture.ts): its behaviour while typing, and its unhappy paths
 * (queries that find nothing, addons that fail, and odd queries).
 */
import { expect, test, type Page } from '@playwright/test';

async function openSearch(page: Page, query: string, size = { width: 1280, height: 800 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/tests/ui/app.html?room=search${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

/** Types `text` into Search's field (focus doesn't start editing; Enter does) and searches for it. */
async function search(page: Page, text: string): Promise<void> {
  const input = page.locator('.outlet .search-box input');
  await input.focus();
  await input.press('Enter');
  await input.fill(text);
  await input.press('Enter');
  await page.evaluate(() => window.orbitTest.settled());
}

test('a search for one long unbroken word wraps inside the No results box', async ({ page }) => {
  await openSearch(page, '', { width: 900, height: 800 });
  await search(page, 'supercalifragilistic'.repeat(15));
  const box = page.locator('.outlet .search-body .grid-message');
  await expect(box.locator('.home-message-title')).toContainText('No results');
  const [boxRight, titleRight, scrollWidth] = await box.evaluate((el) => [el.getBoundingClientRect().right, el.querySelector('.home-message-title')!.getBoundingClientRect().right, document.querySelector('.outlet')!.scrollWidth]);
  expect(titleRight).toBeLessThanOrEqual(boxRight);
  expect(scrollWidth).toBeLessThanOrEqual(900);
});

test('a TMDB people search that never answers doesn’t hold back the addons’ results', async ({ page }) => {
  await openSearch(page, 'fail.tmdb_search_people=hang');
  const input = page.locator('.outlet .search-box input');
  await input.focus();
  await input.press('Enter');
  await input.fill('harbor');
  await input.press('Enter');
  await expect(page.locator('.outlet .search-top')).toContainText('The Last Harbor', { timeout: 15_000 });
});

test('an addon that answers with something unreadable is said to have failed, not to have stayed silent', async ({ page }) => {
  await openSearch(page, 'fail.addon_request:search=junk');
  await search(page, 'harbor');
  const box = page.locator('.outlet .search-body .grid-message');
  await expect(box.locator('.home-message-title')).toHaveText('Search didn’t work');
  await expect(box.locator('.search-failures')).toHaveText('Cinemeta couldn’t search. The answer came back in a form Orbit couldn’t read.');
  await expect(box.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('offline, a search says so once, without asking to connect TMDB (the saved token is still there)', async ({ page }) => {
  await openSearch(page, 'offline');
  await search(page, 'best horror movies');
  const body = page.locator('.outlet .search-body');
  await expect(body.locator('.grid-message .home-message-title')).toHaveText('You’re offline');
  await expect(body.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(body.getByText('Connect TMDB')).toHaveCount(0);
});

test('offline, an IMDb id isn’t reported as a title that doesn’t exist', async ({ page }) => {
  await openSearch(page, 'offline');
  await search(page, 'tt9100001');
  const box = page.locator('.outlet .search-body .grid-message');
  await expect(box.locator('.home-message-title')).toHaveText('You’re offline');
  await expect(box.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a search read as filters that TMDB can’t answer says search didn’t work, not to check the spelling', async ({ page }) => {
  await openSearch(page, 'fail.tmdb_source_page=error:err.tmdb.unreachable');
  await search(page, 'best horror movies');
  const box = page.locator('.outlet .search-body .grid-message');
  await expect(box.locator('.home-message-title')).toHaveText('Search didn’t work');
  await expect(box.locator('p')).toHaveText('Couldn’t reach TMDB. Check your connection, then try again.');
  await expect(box.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('with no addon that can search, Search says so and offers the addons, not "No results"', async ({ page }) => {
  await openSearch(page, 'addons-off=cinemeta');
  await search(page, 'harbor');
  const box = page.locator('.outlet .search-body .grid-message');
  await expect(box.locator('.home-message-title')).toHaveText('None of your addons can search');
  await expect(box.getByRole('button', { name: 'Manage addons' })).toBeVisible();
});

test('long recent searches stay on one line inside the page, each with its remove button', async ({ page }) => {
  await openSearch(page, '', { width: 900, height: 800 });
  await search(page, 'supercalifragilistic'.repeat(12));
  await search(page, 'harbor '.repeat(40));
  const input = page.locator('.outlet .search-box input');
  await input.fill('');
  await input.press('Space');
  await input.press('Backspace');
  const chips = page.locator('.outlet .search-recent-slot .recent-chip');
  await expect(chips).toHaveCount(2);
  for (const chip of await chips.all()) {
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(900);
    await expect(chip.locator('.recent-remove')).toBeInViewport();
  }
});

const settled = (page: Page) => page.evaluate(() => window.orbitTest.settled());

test('a space typed after the words keeps the results instead of searching again', async ({ page }) => {
  await openSearch(page, '', { width: 1280, height: 1100 });
  const input = page.locator('.outlet .search-box input');
  await input.focus();
  await input.press('Enter');
  await input.pressSequentially('harbor');
  await settled(page);
  await expect(page.locator('.outlet .search-top')).toBeVisible();
  // Watch for the loading skeleton: the results must not blink away while the next word is typed.
  await page.evaluate(() => {
    const seen = { skeleton: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver(() => {
      if (document.querySelector('.outlet .search-top-skeleton')) seen.skeleton = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await input.press(' ');
  await page.waitForTimeout(800);
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { seen: { skeleton: boolean } }).seen.skeleton)).toBe(false);
  await expect(page.locator('.outlet .search-top')).toBeVisible();
});

// A light theme and a title with no art: the banner showed the page's white panel
// through the shade's clear side, a smear from dark to white under white text.
test('the top result without art is a dark banner on a light theme', async ({ page }) => {
  await openSearch(page, 'theme=light&no-art');
  const input = page.locator('.outlet .search-box input');
  await input.focus();
  await input.press('Enter');
  await input.fill('harbor');
  await input.press('Enter');
  const top = page.locator('.outlet .search-top');
  await expect(top).toContainText('The Last Harbor', { timeout: 15_000 });
  const light = await top.evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
    return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
  });
  expect(light, 'the banner behind white text is dark').toBeLessThan(0.2);
});
