/**
 * Settings laid out in Chromium (app-fixture.ts): every category's page stays inside
 * the window at Orbit's smallest window size (tauri.conf.json: 960×600), whatever
 * takes room beside it (a sidebar nav) and however long its words (German).
 */
import { expect, test, type Page } from '@playwright/test';

const CATEGORIES = ['general', 'appearance', 'home-library', 'playback', 'player', 'subtitles', 'picture-sound', 'addons', 'accounts', 'downloads', 'shortcuts'];

async function openSettings(page: Page, query: string, [width, height] = [960, 600]): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/tests/ui/app.html?room=settings&lang=de&set.settings.show-all=true&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
}

/** What on the shown category's page reaches past the window's sides (or, with `pane`, the page's own). */
const pastWindow = (page: Page, pane = false) =>
  page.locator('.settings-pane').evaluate((root, pane) => {
    // Against the page, a row's value button may reach a little past it on purpose (its hover wash, settings.css).
    const edge = pane ? root.getBoundingClientRect() : { left: 0, right: innerWidth };
    const slack = pane ? 12 : 0.5;
    return [...root.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && el.checkVisibility() && (box.right > edge.right + slack || box.left < edge.left - slack);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
  }, pane);

for (const [name, query] of [
  ['the top nav', ''],
  ['a sidebar nav', 'set.theme.layout={"position":"sidebar"}'],
  ['a rail nav', 'set.theme.layout={"position":"rail"}'],
] as const) {
  test(`every category stays inside a 960px window, with ${name}`, async ({ page }) => {
    await openSettings(page, query);
    for (const category of CATEGORIES) {
      await page.locator(`.settings-nav-item[data-category="${category}"]`).click();
      await page.evaluate(() => window.orbitTest.settled(4000));
      expect(await pastWindow(page), category).toEqual([]);
    }
  });
}

// The fixture can't zoom the webview, so Couch's 150% at the smallest window is a 640×400 page.
test('every category stays inside its page in a narrow pane (Couch at the smallest window)', async ({ page }) => {
  await openSettings(page, 'look=couch', [640, 400]);
  for (const category of CATEGORIES) {
    await page.locator(`.settings-nav-item[data-category="${category}"]`).click();
    await page.evaluate(() => window.orbitTest.settled(4000));
    expect(await pastWindow(page, true), category).toEqual([]);
  }
});

test("a switch in a row is named by the row's label, not shown with it again beside it", async ({ page }) => {
  await openSettings(page, '');
  for (const category of CATEGORIES) {
    await page.locator(`.settings-nav-item[data-category="${category}"]`).click();
    await page.evaluate(() => window.orbitTest.settled(4000));
    const repeated = await page.locator('.settings-pane').evaluate((pane) =>
      [...pane.querySelectorAll('.setting-row .switch-label')].map((label) => label.textContent ?? '').filter((text) => text.trim()),
    );
    expect(repeated, category).toEqual([]);
  }
});

test("a row's controls leave its text room to be read, at the smallest window with a rail nav", async ({ page }) => {
  await openSettings(page, 'look=marquee');
  for (const category of CATEGORIES) {
    await page.locator(`.settings-nav-item[data-category="${category}"]`).click();
    await page.evaluate(() => window.orbitTest.settled(4000));
    const squeezed = await page.locator('.settings-pane').evaluate((pane) =>
      [...pane.querySelectorAll<HTMLElement>('.setting-row > .setting-text')]
        .filter((text) => text.checkVisibility() && text.getBoundingClientRect().width < 140)
        .map((text) => `${text.querySelector('.setting-label')?.textContent} (${Math.round(text.getBoundingClientRect().width)}px)`),
    );
    expect(squeezed, category).toEqual([]);
  }
});

test("Home rows: a row's name keeps room to be read and stays off its buttons (Arabic, the smallest window)", async ({ page }) => {
  // Arabic's short button labels fit the whole row of buttons beside the name, which was squeezed to a word a line.
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto('/tests/ui/app.html?room=settings&lang=ar');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="home-library"]').click();
  await page.evaluate(() => window.orbitTest.settled(4000));
  const found = await page.locator('.home-rows-list').evaluate((list) =>
    [...list.querySelectorAll<HTMLElement>('.home-row-item')].flatMap((row) => {
      const name = row.querySelector<HTMLElement>('.home-row-name');
      if (!name) return [];
      const box = name.getBoundingClientRect();
      const words = [...name.textContent!.matchAll(/\S+/g)].length;
      const range = document.createRange();
      range.selectNodeContents(name);
      const text = range.getBoundingClientRect();
      const hit = [...row.querySelectorAll('button, [role="switch"]')].some((b) => {
        const r = b.getBoundingClientRect();
        return Math.min(r.right, text.right) - Math.max(r.left, text.left) > 1 && Math.min(r.bottom, text.bottom) - Math.max(r.top, text.top) > 1;
      });
      return (words > 1 && box.width < 140) || hit ? [`${name.textContent} (${Math.round(box.width)}px${hit ? ', under a button' : ''})`] : [];
    }),
  );
  expect(found).toEqual([]);
});

test('the categories stay below the title bar at the end of a long category', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tests/ui/app.html?room=settings');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.outlet').evaluate((outlet) => (outlet.scrollTop = outlet.scrollHeight));
  const [sidebar, outlet] = await Promise.all([page.locator('.settings-sidebar').boundingBox(), page.locator('.outlet').boundingBox()]);
  expect(sidebar!.y, 'sidebar top').toBeGreaterThanOrEqual(outlet!.y);
});

test('a shortcut waiting for its key lets go when another device opens a title over Settings', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=settings');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="shortcuts"]').click();
  await page.locator('[data-focus-id="replace-app.search"]').click();
  await expect(page.locator('.shortcut-row[data-action="app.search"] .shortcut-keys.listening')).toBeVisible();
  // As a phone remote or Orbit Connect does: no key, no click.
  expect(await page.evaluate(() => window.orbitTest.openTitle('The Last Harbor'))).toBe(true);
  await page.keyboard.press('KeyS');
  await page.keyboard.press('Slash');
  // The keys did what they do there: S went by, and / went to Search, rather than becoming Search's key.
  expect(await page.evaluate(() => window.orbitTest.settings.get('shortcuts.keys') ?? null)).toBeNull();
  await expect(page.locator('.outlet .search-box input')).toBeVisible();
});

test('About Orbit credits TMDB and TVmaze for the data they provide', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="general"]').click();
  const legal = page.locator('.about-legal');
  await expect(legal).toContainText('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  await expect(legal).toContainText('Episode air times from TVmaze (tvmaze.com), CC BY-SA 4.0');
});

test('moving a subtitle style slider saves the style once it rests, not on every step', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="subtitles"]').click();
  const size = page.locator('[data-focus-id="subtitle-size"]');
  await size.focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.orbitTest.settled());
  const saves = await page.evaluate(() => window.orbitTest.calls.filter(([cmd, args]) => cmd === 'settings_set' && (args as { key?: string }).key === 'player.subtitles').map(([, args]) => (args as { value: { size: number } }).value.size));
  expect(saves).toEqual([Number(await size.getAttribute('aria-valuenow'))]);
});
