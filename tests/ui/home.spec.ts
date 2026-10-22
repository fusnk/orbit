/**
 * Home (app-fixture.ts), in every Look: its rows' layout invariants.
 */
import { expect, test, type Page } from '@playwright/test';

/** src/theme/looks.ts LOOK_IDS (importing it here would bring the app's CSS into Node). */
const LOOK_IDS = ['orbit', 'crimson', 'marquee', 'premiere', 'glass', 'aurora', 'couch', 'afterglow', 'arc'];

async function openHome(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?room=home&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

// A Top 10 card shows its whole name on the poster (it wraps, never cut off): a native tooltip would only repeat it,
// drawn by Windows over the next card, as the cast cards' did.
test('Top 10 cards have no tooltip repeating the name they show', async ({ page }) => {
  await openHome(page, '');
  const cards = await page.locator('.outlet .ranked-card').evaluateAll((all) =>
    all.map((card) => {
      const name = card.querySelector<HTMLElement>('.ranked-title')!;
      const whole = name.scrollWidth <= name.clientWidth && name.scrollHeight <= name.clientHeight;
      return { name: name.textContent, repeats: whole && card.getAttribute('title') === name.textContent };
    }),
  );
  expect(cards.length).toBeGreaterThan(10);
  for (const card of cards) expect(card).toEqual({ name: card.name, repeats: false });
});

// The trailer's sound button shows only while a trailer plays, which the fixture never does, so it's shown by hand:
// in Carousel it sat on the Featured titles list's corner (its top-corner place outranked "below the list").
for (const look of LOOK_IDS) {
  for (const [room, width] of ['home', 'explore'].flatMap((r) => [[r, 1100], [r, 1920]] as const)) {
    test(`${look} ${room} ${width}px: the trailer's sound button is clear of the Featured titles list`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(`/tests/ui/app.html?room=${room}&look=${look}`);
      await page.waitForFunction(() => 'orbitTest' in window);
      expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
      const boxes = await page.evaluate(() => {
        const hero = [...document.querySelectorAll<HTMLElement>('.outlet .hero')].find((el) => el.checkVisibility());
        const sound = hero?.querySelector<HTMLElement>('.trailer-sound');
        const queue = hero?.querySelector<HTMLElement>('.hero-queue');
        if (!sound || !queue) return null;
        sound.hidden = false;
        const box = (el: HTMLElement) => (el.checkVisibility() ? el.getBoundingClientRect().toJSON() : null);
        return { sound: box(sound), queue: box(queue) };
      });
      test.skip(!boxes?.sound || !boxes.queue, 'no Featured titles list beside the sound button here');
      const { sound, queue } = boxes!;
      const apart = sound!.right <= queue!.left || sound!.left >= queue!.right || sound!.bottom <= queue!.top || sound!.top >= queue!.bottom;
      expect(apart, `sound ${JSON.stringify(sound)} vs list ${JSON.stringify(queue)}`).toBe(true);
    });
  }
}

for (const query of [...LOOK_IDS.map((look) => `look=${look}`), 'theme=light']) {
  // The tile is a button: only its frame is drawn, never the browser's grey button face and border around it.
  test(`${query}: "See all" tiles draw only their frame`, async ({ page }) => {
    await openHome(page, query);
    const tiles = await page.locator('.outlet .see-all-tile').evaluateAll((all) =>
      all.map((tile) => {
        const style = getComputedStyle(tile);
        return { background: style.backgroundColor, border: style.borderTopWidth, padding: style.paddingTop };
      }),
    );
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(tile).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', padding: '0px' });
  });
}

// An addon that lists a title twice in a catalog: each row still shows it once.
test('a catalog that lists a title twice shows it once in its row', async ({ page }) => {
  await openHome(page, 'fail.addon_request:cinemeta=repeat');
  const rows = await page.locator('.outlet section.rail').evaluateAll((all) =>
    all.map((row) => {
      const ids = [...row.querySelectorAll('[data-focus-id^="poster:"]')].map((card) => card.getAttribute('data-focus-id'));
      return { row: row.querySelector('.rail-heading')?.textContent, cards: ids.length, unique: new Set(ids).size };
    }),
  );
  const popular = rows.find((row) => row.row === 'Popular Movies');
  expect(popular?.cards).toBeGreaterThan(10);
  for (const row of rows) expect(row).toEqual({ ...row, cards: row.unique });
});

// A genre tile's page comes from an addon's catalog: an addon refusing it points to the addon, never to TMDB's key.
test('a genre page an addon refuses says so, not that TMDB’s key expired', async ({ page }) => {
  await openHome(page, 'fail.addon_request:genre=http:401');
  const tile = page.locator('.outlet .genre-tile').filter({ hasText: 'Drama' }).filter({ visible: true }).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.evaluate(() => window.orbitTest.settled());
  const message = page.locator('.outlet .explore-grid .grid-message').filter({ visible: true });
  await expect(message).toContainText('The addon refused the request');
  await expect(message).not.toContainText('TMDB');
});

// A mood chip whose catalogs have nothing that fits: its row says so under the lit chip, rather than nothing appearing.
test('a mood chip with nothing to show says so', async ({ page }) => {
  await openHome(page, 'fail.tmdb_token_saved=null&fail.addon_request=empty');
  await page.locator('.outlet .mood-chip').filter({ visible: true }).first().click();
  await page.evaluate(() => window.orbitTest.settled());
  const row = page.locator('.outlet .mood-chips-results section.rail');
  await expect(row).toBeVisible();
  await expect(row.locator('.rail-empty')).toContainText('Nothing fits this mood right now');
});

// The card banner's strip of picks: with no artwork (none, or a dead CDN) each frame names its title, rather than
// five blank boxes; with artwork the picture alone shows.
test('the banner strip names its picks when their artwork is missing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const named = () => page.locator('.outlet .hero-queue-thumb-name').evaluateAll((all) => all.filter((el) => el.checkVisibility()).map((el) => el.textContent));
  await openHome(page, 'no-art');
  const names = await named();
  expect(names).toHaveLength(5);
  expect(names.every(Boolean)).toBe(true);
  await openHome(page, '');
  expect(await named()).toEqual([]);
});
