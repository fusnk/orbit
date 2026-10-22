/**
 * The player's Settings views in the whole app (app.html), with a show's episode playing and
 * mpv's track and chapter lists sent as it would.
 */
import { expect, test, type Page } from '@playwright/test';

const TRACKS = [
  { id: 1, kind: 'audio', title: null, lang: 'eng', codec: 'eac3', channels: 6, selected: true, secondary: false, external: false, default: true, forced: false },
  { id: 1, kind: 'sub', title: 'English (SDH)', lang: 'eng', codec: 'subrip', channels: null, selected: true, secondary: false, external: false, default: true, forced: false },
  { id: 2, kind: 'sub', title: 'Forced', lang: 'eng', codec: 'subrip', channels: null, selected: false, secondary: false, external: false, default: false, forced: true },
  { id: 3, kind: 'sub', title: null, lang: 'fra', codec: 'ass', channels: null, selected: false, secondary: false, external: false, default: false, forced: false },
];

/** Sends a player event for the file open now. */
const send = (page: Page, event: Record<string, unknown>) =>
  page.evaluate(async (e) => {
    const open = window.orbitTest.calls.filter(([cmd]) => cmd === 'player_open').at(-1);
    await window.orbitTest.emit('player://event', { load: (open?.[1] as { load: number }).load, ...e });
  }, event);

async function openPlayer(page: Page, query = ''): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(() => window.orbitTest.openPlayer('Blackwater County'));
  await expect(page.locator('.player.started')).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await send(page, { kind: 'tracks', tracks: TRACKS });
}

/** How far each of a view's chips, slider labels and values sits from the panel's sides (the narrowest). */
const insets = (page: Page) =>
  page.locator('.player-panel:not([hidden])').evaluate((panel) => {
    const edge = panel.getBoundingClientRect();
    const near = [...panel.querySelectorAll<HTMLElement>('.chip, .slider-label, .slider-value')].filter((el) => el.offsetWidth > 0).map((el) => el.getBoundingClientRect());
    return { start: Math.min(...near.map((r) => r.left - edge.left)), end: Math.min(...near.map((r) => edge.right - r.right)) };
  });

test('Controls size: the slider lines up with the chips, clear of the panel edges', async ({ page }) => {
  await openPlayer(page);
  await page.locator('.player-button[aria-label="Settings"]').click();
  await page.locator('[data-focus-id="hub-controls-size"]').click();
  const chip = (await page.locator('.player-panel:not([hidden]) .chip').first().boundingBox())!;
  const label = (await page.locator('.player-panel:not([hidden]) .slider-label').boundingBox())!;
  expect(Math.abs(label.x - chip.x), 'label under the first chip').toBeLessThanOrEqual(1);
  const { start, end } = await insets(page);
  expect(start).toBeGreaterThanOrEqual(16);
  expect(end).toBeGreaterThanOrEqual(16);
});

test("no view's contents touch the panel header", async ({ page }) => {
  test.setTimeout(120_000);
  await openPlayer(page);
  const gaps: Record<string, number> = {};
  const gap = () =>
    page.locator('.player-panel:not([hidden])').evaluate((panel) => {
      const header = panel.querySelector('.player-panel-header')!.getBoundingClientRect().bottom;
      const first = [...panel.querySelector('.player-panel-body')!.children].find((el) => (el as HTMLElement).offsetHeight > 0)!;
      return Math.round(first.getBoundingClientRect().top - header);
    });
  const views = ['picture', 'source', 'subtitles', 'audio', 'transcript', 'chapters', 'speed', 'subtitle-style', 'timing', 'sound', 'sleep', 'info', 'controls-size'];
  for (const view of views) {
    if (!(await page.locator('.player-panel:not([hidden]) .hub-grid').isVisible())) await page.keyboard.press('c');
    const entry = page.locator(`.player-panel:not([hidden]) [data-focus-id="hub-${view}"]`);
    if (!(await entry.isVisible())) continue;
    await entry.click();
    gaps[view] = await gap();
    await page.locator('.player-panel:not([hidden]) .player-panel-header button').first().click();
  }
  await page.keyboard.press('Escape');
  await page.locator('.player-button[aria-label="Episodes"]').click();
  gaps.episodes = await gap();
  expect(Object.keys(gaps).length).toBeGreaterThan(10);
  expect(Object.entries(gaps).filter(([, px]) => px < 6)).toEqual([]);
});

test("Stream info: the switch lines up with the list under it", async ({ page }) => {
  await openPlayer(page);
  await page.keyboard.press('c');
  await page.locator('[data-focus-id="hub-info"]').click();
  const label = (await page.locator('.player-panel:not([hidden]) .switch-label').boundingBox())!;
  const term = (await page.locator('.player-panel:not([hidden]) dt').first().boundingBox())!;
  expect(Math.abs(label.x - term.x), 'label over the first term').toBeLessThanOrEqual(1);
});

test('right to left, an English chapter name in the hub is cut at its end, not its start', async ({ page }) => {
  await openPlayer(page, 'lang=ar');
  await send(page, { kind: 'chapters', chapters: [{ time: 0, title: 'The harbour at night, and a very long chapter title that runs on and on' }] });
  await page.keyboard.press('c');
  const value = page.locator('[data-focus-id="hub-chapters"] .hub-row-value');
  const [box, first] = await value.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 1);
    const r = range.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return [{ left: b.left, right: b.right }, { left: r.left, right: r.right }];
  });
  expect(first.left, 'its first letter shows').toBeGreaterThanOrEqual(box.left - 1);
  expect(first.right).toBeLessThanOrEqual(box.right + 1);
});

test('Subtitles opens on the language showing, not scrolled down to the second subtitle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPlayer(page);
  await page.locator('.player-button[aria-label="Settings"]').click();
  await page.locator('[data-focus-id="hub-subtitles"]').click();
  await expect(page.locator('.player-panel:not([hidden]) [data-focus-id="sub-off"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="lang-en"]')).toBeFocused();
  expect(await page.locator('.player-panel:not([hidden]) .player-panel-body').evaluate((el) => el.scrollTop)).toBe(0);
});
