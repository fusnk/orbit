/**
 * Keyboard, remote and controller navigation in the whole app (app-fixture.ts): arrows move focus
 * to what's nearest that way on screen (src/app/spatial.ts), Enter activates, Back returns.
 */
import { expect, test, type Page } from '@playwright/test';

/** Opens the fixture with `query`, motion reduced so focus moves and scrolls land at once. */
async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/tests/ui/app.html?set.appearance={"motion":"reduce"}&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

/** The focused element's `data-focus-id`, or its tag when it has none ("body" when focus is lost). */
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.focusId ?? document.activeElement?.tagName.toLowerCase() ?? null);

/** Focuses `selector` as the arrow keys would (a key pressed first, so focus shows as it does from the keyboard). */
async function focusByKeys(page: Page, selector: string): Promise<void> {
  await page.keyboard.press('ArrowDown');
  await page.locator(selector).filter({ visible: true }).first().focus();
}

test("a pad's moves show the focus ring after a mouse click, on the title page's buttons too", async ({ page }) => {
  await openApp(page, 'title=The Last Harbor');
  // A real click on My Library (it only toggles): the browser hides the ring after a click, and on focus script moves next.
  const add = page.locator('.detail .hero-actions button').filter({ visible: true }).nth(1);
  await add.click();
  expect(await add.evaluate((el) => el === document.activeElement && !el.matches(':focus-visible')), 'clicked, no ring').toBe(true);
  // A pad's Left, as gamepad.ts sends it: a synthetic key press.
  await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(await add.evaluate((el) => el !== document.activeElement), 'moved').toBe(true);
  expect(await page.evaluate(() => document.activeElement!.matches(':focus-visible')), 'ring shows').toBe(true);
});

test('Right and Left from the title bar stay in it', async ({ page }) => {
  // Thirteen page loads, each a few seconds of unbundled modules from Vite: more than the default 30s on a busy runner.
  test.slow();
  // Glass's pill and capsule float below the bar's own strip; Aurora's pill is at the bottom.
  for (const look of ['', 'look=glass&', 'look=aurora&']) {
    for (const room of ['home', 'library', 'live', 'addons']) {
      await openApp(page, `${look}room=${room}`);
      // The last button in the bar: nothing in the bar lies further right. Down goes to the page.
      await focusByKeys(page, '.titlebar .settings-button');
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.className), `${look}${room}`).toContain('settings-button');
    }
  }
  // Left from the pill's first page reaches the wordmark's side of the bar, not the page under it.
  await openApp(page, 'look=glass&room=home');
  await focusByKeys(page, '.nav-item[data-room="home"]');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.titlebar'))).toBe(true);
});

test('Up from the top of a bar that floats over the page goes nowhere, not to a card scrolled under it', async ({ page }) => {
  // Afterglow's Cinematic bar floats over the page, as the TV's does; the page scrolls under it.
  await openApp(page, 'look=afterglow&room=movies');
  await page.evaluate(() => document.querySelector('.outlet')!.scrollBy({ top: 900, behavior: 'instant' }));
  await page.locator('.titlebar .wordmark').focus();
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.titlebar'))).toBe(true);
});

test('arrows from outside a row never land on a card scrolled out of sight in it', async ({ page }) => {
  await openApp(page);
  // Two rows of posters on screen, the upper one scrolled along so its first cards are out of sight.
  await page.evaluate(() => {
    const tracks = [...document.querySelectorAll<HTMLElement>('.view-shown .rail-track')];
    const at = tracks.findIndex((t, i) => i > 0 && [t, tracks[i - 1]!].every((r) => r.querySelectorAll('.poster-card').length >= 10));
    tracks[at]!.scrollIntoView({ block: 'end' });
    tracks[at - 1]!.scrollBy({ left: 900, behavior: 'instant' });
    tracks[at]!.dataset.testLower = '';
    tracks[at - 1]!.dataset.testUpper = '';
  });
  const lower = page.locator('[data-test-lower]');
  await page.keyboard.press('ArrowDown');
  await lower.locator('.poster-card').first().focus();
  await page.keyboard.press('ArrowLeft');
  // Nothing on screen lies left of the lower row's first card: the upper row's first cards are out of sight.
  await expect(lower.locator('.poster-card').first()).toBeFocused();
  // From inside a row, the next card along is reached though it's out of sight (and scrolled to).
  const place = () => page.evaluate(() => [...document.querySelectorAll('[data-test-upper] .poster-card')].indexOf(document.activeElement!));
  await page.keyboard.press('ArrowUp');
  const above = await place();
  expect(above).toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  expect(await place()).toBe(above - 1);
});

/** How far the focused element's ring (its widest box-shadow spread) is cut by a scrolling ancestor inside the page, per side. */
const ringCut = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const spreads = [...getComputedStyle(el).boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => Number(m[4]));
    const ring = Math.max(0, ...spreads);
    const r = el.getBoundingClientRect();
    const cuts: string[] = [];
    for (let at = el.parentElement; at && !at.classList.contains('outlet'); at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const box = at.getBoundingClientRect();
      const left = box.left + at.clientLeft;
      const top = box.top + at.clientTop;
      const cut = { left: left - (r.left - ring), top: top - (r.top - ring), right: r.right + ring - (left + at.clientWidth), bottom: r.bottom + ring - (top + at.clientHeight) };
      for (const [side, by] of Object.entries(cut)) if (by > 0.5) cuts.push(`${at.className.split(' ')[0]} cuts ${side} by ${by}px`);
    }
    return { ring, cuts };
  });

test("a title page's cast and pictures rows leave room for the focus ring", async ({ page }) => {
  // Couch's TV ring is the widest (6px).
  for (const look of ['orbit', 'couch']) {
    await openApp(page, `look=${look}&title=Blackwater County`);
    for (const selector of ['.cast-row .cast-member', '.media-row .media-card']) {
      const first = page.locator(selector).first();
      await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await focusByKeys(page, selector);
      const { ring, cuts } = await ringCut(page);
      expect(ring, `${look} ${selector} has a ring`).toBeGreaterThan(0);
      expect(cuts, `${look} ${selector}`).toEqual([]);
    }
  }
});

test('with the menu beside the page, Up and Down go row to row in the page, not into the menu', async ({ page }) => {
  // Couch: a sidebar; Marquee: a rail of icons.
  for (const look of ['couch', 'marquee']) {
    await openApp(page, `look=${look}`);
    const path: string[] = [];
    for (const key of [...Array(10).fill('ArrowDown'), ...Array(4).fill('ArrowUp')]) {
      await page.keyboard.press(key);
      path.push(`${key} ${await page.evaluate(() => (document.activeElement?.closest('.nav') ? 'menu: ' : '') + ((document.activeElement as HTMLElement).dataset.focusId ?? document.activeElement!.textContent!.trim()))}`);
    }
    expect(path.filter((step) => step.includes('menu: ')), `${look}: ${path.join(', ')}`).toEqual([]);
    // Left along the row, then from its first card, still reaches the menu.
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.nav .nav-item:focus'), `${look}: Left after ${path.at(-1)}`).toHaveCount(1);
  }
});

test("a show's page opened from its card puts focus on Play", async ({ page }) => {
  await openApp(page);
  // A show's Play waits for its episodes, so it can't take focus as the page opens; it takes it once they're in.
  const card = page.locator('.outlet .poster-card[data-focus-id="poster:tt9200001"]').filter({ visible: true }).first();
  await card.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'center' }));
  await page.keyboard.press('ArrowDown');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe('play');
});

test('Back to My Library after taking the title out of it puts focus on a card beside where it was', async ({ page }) => {
  test.slow();
  await openApp(page, 'room=library');
  const cards = page.locator('.outlet .library [data-focus-id^="poster:"]').filter({ visible: true });
  const card = cards.nth(5);
  const id = await card.getAttribute('data-focus-id');
  const at = await card.boundingBox();
  await page.keyboard.press('ArrowDown');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe('play');
  // The page's My Library button, pressed from the keyboard: the title leaves the library.
  const saved = page.locator('.detail .hero-actions button').filter({ visible: true }).nth(1);
  await saved.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator(`.outlet .library [data-focus-id="${id}"]`)).toHaveCount(0);
  const now = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const box = el.getBoundingClientRect();
    return { id: el.dataset.focusId ?? el.tagName.toLowerCase(), x: box.x, y: box.y };
  });
  expect(now.id).toMatch(/^poster:/);
  // Its neighbour, which moved into its place, not one across the page.
  expect(Math.hypot(now.x - at!.x, now.y - at!.y)).toBeLessThan(400);
});

test("My Library: a card taken out from its menu hands focus to the card that moves into its place", async ({ page }) => {
  test.slow();
  await openApp(page, 'room=library');
  const cards = page.locator('.outlet .library-results [data-focus-id^="poster:"]').filter({ visible: true });
  const next = await cards.nth(3).getAttribute('data-focus-id');
  await page.keyboard.press('ArrowDown');
  await cards.nth(2).focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.menu .menu-item', { hasText: 'Remove from My Library' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe(next);
});

test('My Library: a card taken out of its Continue Watching row hands focus to the next one in the row', async ({ page }) => {
  test.slow();
  await openApp(page, 'room=library');
  const cards = page.locator('.outlet .library .rail-track [data-focus-id^="continue:"]').filter({ visible: true });
  const next = await cards.nth(1).getAttribute('data-focus-id');
  await page.keyboard.press('ArrowDown');
  await cards.nth(0).focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.menu .menu-item', { hasText: 'Remove from Continue Watching' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe(next);
});

test('Discover: a card marked Not interested from its menu hands focus to the next one in its row', async ({ page }) => {
  test.slow();
  await openApp(page, 'room=explore');
  // The sections are built as they scroll near.
  await page.locator('.outlet').evaluate((el) => el.scrollBy({ top: 900, behavior: 'instant' }));
  const row = page.locator('.outlet .explore-sections .rail-track').filter({ visible: true }).first();
  const cards = row.locator('[data-focus-id^="poster:"]');
  await expect.poll(() => cards.count()).toBeGreaterThan(2);
  const next = await cards.nth(2).getAttribute('data-focus-id');
  await page.keyboard.press('ArrowDown');
  await cards.nth(1).focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.menu .menu-item', { hasText: 'Not interested' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe(next);
});

test('Enter held on a card opens its page without pressing Play there too', async ({ page }) => {
  // The player's modules load on the last press, on top of the app's.
  test.slow();
  await openApp(page, 'room=movies');
  const card = page.locator('.outlet [data-focus-id^="poster:"]').filter({ visible: true }).nth(3);
  await page.keyboard.press('ArrowDown');
  await card.focus();
  // Held: the key repeats (a remote's OK held down does the same), landing on what the press opened.
  await page.keyboard.down('Enter');
  await expect.poll(() => focused(page)).toBe('play');
  for (let i = 0; i < 3; i++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.locator('.player')).toHaveCount(0);
  expect(await focused(page)).toBe('play');
  // A fresh press is deliberate.
  await page.keyboard.press('Enter');
  await expect(page.locator('.player')).toHaveCount(1);
});
