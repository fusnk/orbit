/**
 * The Addons page laid out in Chromium (app-fixture.ts): in a narrow page (Couch's 150%
 * at the smallest window, which the fixture can't zoom, so a 640×400 page) each addon's
 * text keeps its whole width and nothing in it sits under its buttons.
 */
import { expect, test, type Page } from '@playwright/test';

/** What in each addon row's text sits under its buttons, or has too little width to read. */
const rowProblems = (page: Page) =>
  page.locator('.addons-page').evaluate((room) => {
    const out: string[] = [];
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (const row of room.querySelectorAll<HTMLElement>('.addon-row')) {
      const name = row.querySelector('strong')?.textContent ?? '?';
      const buttons = [...row.querySelectorAll('.addon-actions button')].map((b) => b.getBoundingClientRect());
      for (const el of row.querySelectorAll<HTMLElement>('.addon-info *')) {
        const box = el.getBoundingClientRect();
        if (box.width && buttons.some((b) => overlap(box, b))) out.push(`${name}: ${el.className || el.tagName} under a button`);
      }
      // A name, description or address broken into one or two words a line can't be read.
      const info = row.querySelector<HTMLElement>('.addon-info')!;
      if (info.clientWidth < 200) out.push(`${name}: text column ${info.clientWidth}px`);
    }
    return out;
  });

test('addon rows stay readable in a narrow page', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/tests/ui/app.html?room=addons&look=couch');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  const problems = await rowProblems(page);
  expect(problems).toEqual([]);
});

test('a long name with no spaces wraps instead of running under the buttons', async ({ page }) => {
  // An addon names itself (untrusted, any length): one unbroken word must break inside its column.
  const manifest = { id: 'org.orbit.film-archive', version: '0.9.4', name: 'TheFilmArchiveAddonWithAnUnbrokenNameThatNeverEnds', types: ['movie'], resources: ['catalog'], catalogs: [] };
  // The smallest window (960×600) at 110% scale.
  await page.setViewportSize({ width: 873, height: 545 });
  await page.goto(`/tests/ui/app.html?room=addons&addon.film-archive=${encodeURIComponent(JSON.stringify({ manifest }))}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  expect(await rowProblems(page)).toEqual([]);
});

test("an addon's page keeps a long unbroken name and catalog name inside the window", async ({ page }) => {
  const word = 'TheFilmArchiveAddonWithAnUnbrokenNameThatNeverEnds';
  const manifest = { id: 'org.orbit.film-archive', version: '0.9.4', name: word, types: ['movie'], resources: ['catalog'], catalogs: [{ type: 'movie', id: 'docs', name: `${word}Documentaries`, extra: [] }] };
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto(`/tests/ui/app.html?room=addons&addon.film-archive=${encodeURIComponent(JSON.stringify({ manifest }))}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.addon-row').nth(3).getByRole('button', { name: 'Details' }).click();
  const details = page.locator('.addon-details');
  await expect(details).toBeVisible();
  // How far each reaches past the page's right edge.
  const right = await details.evaluate((el) => {
    const edge = el.getBoundingClientRect().right;
    const past = (sel: string) => Math.round(el.querySelector(sel)!.getBoundingClientRect().right - edge);
    return { name: past('.addon-heading h1'), catalog: past('.catalog-item strong'), preview: past('.catalog-item button') };
  });
  expect(Object.entries(right).filter(([, px]) => px > 1)).toEqual([]);
});

test("an addon's own words keep their direction on a right-to-left page", async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=addons&lang=ar');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  // English names and descriptions on an Arabic page: their full stop stays at their end.
  const direction = (selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => getComputedStyle(el).direction));
  expect(await direction('.addon-row .addon-description')).toEqual(['ltr', 'ltr', 'ltr', 'ltr']);
  await page.locator('.addon-row').nth(2).locator('.addon-actions button').nth(3).click();
  await page.evaluate(() => window.orbitTest.settled());
  expect(await direction('.addon-details .addon-heading h1, .addon-details > p:not(.muted, .status)')).toEqual(['ltr', 'ltr']);
});

/** Types `url` into Add an addon and loads it; returns the line under the field. */
async function loadAddon(page: Page, url: string): Promise<string> {
  const field = page.locator('.addons-install input');
  await field.click();
  await field.fill(url);
  await page.locator('.addons-install .install-row button').click();
  await page.evaluate(() => window.orbitTest.settled());
  return (await page.locator('.addons-install .status').textContent()) ?? '';
}

test('an addon installs from its link and joins the list', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=addons');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  expect(await loadAddon(page, 'stremio://cool-films.example.com/manifest.json')).toBe('');
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.evaluate(() => window.orbitTest.settled());
  await expect(page.locator('.addon-row strong', { hasText: 'Cool Films' })).toBeVisible();
});

test('a link that can’t be installed says why in plain words', async ({ page }) => {
  test.setTimeout(120_000);
  const cases: [query: string, url: string, says: string][] = [
    ['', 'https://cool-films.example.com/', 'That isn’t an addon’s install link. Install links end in /manifest.json.'],
    ['fail.addon_fetch_manifest=http:404', 'https://cool-films.example.com/manifest.json', 'There’s no addon at that address.'],
    ['fail.addon_fetch_manifest=wrong-shape', 'https://cool-films.example.com/manifest.json', 'That address didn’t answer with an addon.'],
    ['offline', 'https://cool-films.example.com/manifest.json', 'You’re offline. Connect to the internet, then try again.'],
  ];
  for (const [query, url, says] of cases) {
    await page.goto(`/tests/ui/app.html?room=addons&${query}`);
    await page.waitForFunction(() => 'orbitTest' in window);
    expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
    const line = await loadAddon(page, url);
    expect(line, query || url).toContain(says);
    // Never the schema's or Rust's own English ("Invalid key", "must end in").
    expect(line).not.toMatch(/Invalid|Expected|must end|\(error \d+\)/);
  }
});

test('a link that needs setting up offers Set up, which opens its page in the browser', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=addons');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await loadAddon(page, 'https://cool-films.example.com/configure-me/manifest.json');
  await page.locator('.addons-install .install-preview').getByRole('button', { name: 'Set up', exact: true }).click();
  await page.evaluate(() => window.orbitTest.settled());
  const opened = await page.evaluate(() => window.orbitTest.calls.filter(([c]) => c === 'open_addon_configure').map(([, a]) => (a as { url: string }).url));
  expect(opened).toEqual(['https://cool-films.example.com/configure-me/configure']);
  // Then it waits for the link that page gives.
  await expect(page.locator('.addons-install .status')).toContainText('paste the install link');
});

test('an addon list that can’t be read says so, with Try again, not "No addons installed"', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=addons&fail.addon_list=storage');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  const list = page.locator('.addons-page .addon-list').first();
  await expect(list).not.toContainText('No addons installed');
  await expect(list.locator('.state-message')).toContainText('Couldn’t load your addons');
  await expect(list.getByRole('button', { name: 'Try again' })).toBeVisible();
});
