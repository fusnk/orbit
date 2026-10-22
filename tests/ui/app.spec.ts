/**
 * The whole app in Chromium (app-fixture.ts): every top-level page, a film's and a show's
 * title page and the player open with sample data, with no page errors, no console errors
 * and nothing fetched from the network. The base for layout sweeps (see README.md).
 */
import { expect, test, type Page } from '@playwright/test';

/** Opens the fixture with `query` and waits until its first page has settled; returns what went wrong meanwhile. */
async function openApp(page: Page, query: string): Promise<{ problems: string[] }> {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  // Artwork comes from the fixture's service worker; anything else for another host went to the network.
  page.on('requestfinished', async (request) => {
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (!(await request.response())?.fromServiceWorker()) problems.push(`network request: ${request.url()}`);
  });
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  return { problems };
}

/** The page shown (Home stays in the page, hidden, behind the others). */
const shown = (page: Page, text: string) => page.locator('.outlet').getByText(text, { exact: false }).filter({ visible: true }).first();
const outlet = (page: Page) => page.locator('.outlet');

/** Each page, and what shows it drew its content. */
const ROOMS: [room: string, content: (page: Page) => Promise<void>][] = [
  ['home', async (page) => expect(await outlet(page).locator('.card').count()).toBeGreaterThan(20)],
  ['movies', async (page) => expect(await outlet(page).locator('.poster-card').count()).toBeGreaterThan(20)],
  ['series', async (page) => expect(await outlet(page).locator('.poster-card').count()).toBeGreaterThan(10)],
  ['anime', async (page) => expect(await outlet(page).locator('.poster-card').count()).toBeGreaterThan(3)],
  ['explore', async (page) => expect(await outlet(page).locator('.card').count()).toBeGreaterThan(10)],
  ['live', async (page) => await expect(shown(page, 'Orbit News 24')).toBeVisible()],
  ['search', async (page) => expect(await outlet(page).locator('.card').count()).toBeGreaterThan(5)],
  ['library', async (page) => expect(await outlet(page).locator('.card').count()).toBeGreaterThan(10)],
  ['downloads', async (page) => await expect(shown(page, 'Echoes of Tomorrow')).toBeVisible()],
  ['addons', async (page) => await expect(shown(page, 'Sample Streams')).toBeVisible()],
  ['settings', async (page) => expect(await outlet(page).locator('.settings-nav-item').count()).toBeGreaterThan(5)],
];

for (const [room, content] of ROOMS) {
  test(`${room} draws its content`, async ({ page }) => {
    const { problems } = await openApp(page, `room=${room}`);
    if (room !== 'settings') await expect(page.locator(`.nav-item[data-room="${room}"]`)).toHaveAttribute('aria-current', 'page');
    await content(page);
    expect(problems).toEqual([]);
  });
}

test('Discover draws every section, down to the last, with nothing left unanswered', async ({ page }) => {
  const { problems } = await openApp(page, 'room=explore');
  // Sections further down load as they're scrolled near.
  const end = await outlet(page).evaluate((el) => el.scrollHeight);
  for (let y = 0; y < end; y += 600) {
    await outlet(page).evaluate((el, y) => (el.scrollTop = y), y);
    await page.evaluate(() => window.orbitTest.settled(3000));
  }
  expect(await page.evaluate(() => [...window.orbitTest.unanswered])).toEqual([]);
  await expect(outlet(page).getByRole('button', { name: 'Retry' }).filter({ visible: true })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a film's title page", async ({ page }) => {
  const { problems } = await openApp(page, 'title=The Last Harbor');
  await expect(shown(page, 'A retired harbor pilot')).toBeVisible();
  await expect(shown(page, 'Ava Okafor')).toBeVisible();
  expect(problems).toEqual([]);
});

test("a show's title page, with its episodes", async ({ page }) => {
  const { problems } = await openApp(page, 'title=Blackwater County');
  await expect(shown(page, 'Season 4')).toBeVisible();
  await expect(shown(page, 'Mark season as watched')).toBeVisible();
  expect(problems).toEqual([]);
});

test('the player opens and plays', async ({ page }) => {
  const { problems } = await openApp(page, '');
  await page.evaluate(() => window.orbitTest.openPlayer());
  await expect(page.locator('.player.started')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a Look, a light theme and another language', async ({ page }) => {
  const { problems } = await openApp(page, 'look=couch&theme=light&lang=de&room=movies');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.nav-item[data-room="movies"]')).toHaveText('Filme');
  expect(problems).toEqual([]);
});

// Pages kept in the page while another shows (router.ts `keep`) are hidden out of the flow (styles.css). A rule
// giving those pages `position: relative` once outranked that, so each one left behind stood in the flow as an
// empty block and pushed the page shown down (Discover's banner sat 228px under the title bar).
test('pages kept behind the one shown take no room above it', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=home');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  for (const room of ['movies', 'series', 'library', 'live', 'downloads', 'explore', 'home']) {
    await page.locator(`.nav-item[data-room="${room}"]`).click();
    await page.evaluate(() => window.orbitTest.settled(3000));
    const placed = await page.evaluate(() => {
      const outlet = document.querySelector<HTMLElement>('.outlet')!;
      const shown = outlet.querySelector<HTMLElement>(':scope > .view-shown')!;
      const inFlow = [...outlet.children].filter((el) => el !== shown && getComputedStyle(el).position !== 'absolute').map((el) => el.className);
      return { inFlow, top: shown.offsetTop };
    });
    expect(placed, `after ${room}`).toEqual({ inFlow: [], top: 0 });
  }
});
