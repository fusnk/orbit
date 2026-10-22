/**
 * Settings → Player and Theme Studio's seek bar in every player layout. A layout's own CSS must not
 * outrank what the person picked: a switch turned off stays off, and the seek bar keeps Studio's
 * thickness and colour (each layout only adjusts them).
 */
import { expect, test, type Page } from '@playwright/test';

const PRESETS = ['orbit', 'minimal', 'streaming', 'theater', 'cinema', 'compact', 'floating', 'tv', 'arc'];

/** The whole app (app-fixture.ts) playing a show's episode, which has a next episode. */
async function openPlayer(page: Page, settings: Record<string, unknown>): Promise<void> {
  const query = Object.entries(settings)
    .map(([key, value]) => `set.${key}=${encodeURIComponent(JSON.stringify(value))}`)
    .join('&');
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => window.orbitTest.openPlayer('Blackwater County'));
}

/** Elements matching `selector` that are drawn (not display:none, visibility:hidden or zero-sized). */
const drawn = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.filter((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }).length,
  );

const seekBar = (page: Page) =>
  page.locator('.player .seek').first().evaluate((seek) => ({
    track: parseFloat(getComputedStyle(seek.querySelector('.seek-track')!).height),
    fill: getComputedStyle(seek.querySelector('.seek-fill')!).backgroundColor,
    fillImage: getComputedStyle(seek.querySelector('.seek-fill')!).backgroundImage,
  }));

const SEEK_BAR = { style: 'flat', height: 10, color: '#4db8ff', barImage: null, buffered: true, bufferedBrightness: 30, dot: 'circle', dotSize: 14, dotImage: null };
const BLUE = 'rgb(77, 184, 255)';

for (const preset of PRESETS) {
  test(`${preset}: what Settings turns off stays off`, async ({ page }) => {
    await openPlayer(page, { 'player.layout': { preset, title: false, badges: false, next: false, chapters: false, clock: false } });
    await expect(page.locator('.player.started')).toBeVisible();
    expect(await drawn(page, '.layout-next-button'), 'Next episode button').toBe(0);
    expect(await drawn(page, ':is(.layout-badges, .cinema-badges)'), 'badges').toBe(0);
    expect(await drawn(page, '.seek-marks'), 'chapter marks').toBe(0);
    expect(await drawn(page, '.layout-clock'), 'clock').toBe(0);
    expect(await drawn(page, '.player-name > :is(.player-title, .player-episode)'), 'title').toBe(0);
  });

  test(`${preset}: the seek bar keeps Theme Studio's thickness and colour`, async ({ page }) => {
    await openPlayer(page, { 'player.layout': { preset, size: 'standard', timeline: 'line' }, 'theme.seekbar': SEEK_BAR });
    const line = await seekBar(page);
    // 10px, give or take what the layout trims (a pixel) or what its own scale adds.
    expect(line.track, 'Studio thickness').toBeGreaterThanOrEqual(8.5);
    expect(line.fill, 'Studio colour').toBe(BLUE);
  });

  test(`${preset}: the Accent timeline is thicker than Line, in Studio's colour`, async ({ page }) => {
    await openPlayer(page, { 'player.layout': { preset, size: 'standard', timeline: 'line' } });
    const line = await seekBar(page);
    await openPlayer(page, { 'player.layout': { preset, size: 'standard', timeline: 'accent' }, 'theme.seekbar': { ...SEEK_BAR, height: 4 } });
    const accent = await seekBar(page);
    // Minimal keeps its one thin line whatever the timeline.
    if (preset === 'minimal') expect(accent.track).toBe(line.track);
    else expect(accent.track, 'thicker').toBeGreaterThan(line.track);
    expect(accent.fillImage, 'a gradient of the chosen colour').toContain('gradient');
    expect(accent.fillImage).toContain(BLUE);
  });
}

test('cinema: Line is white until Studio picks a colour', async ({ page }) => {
  await openPlayer(page, { 'player.layout': { preset: 'cinema', timeline: 'line' } });
  expect((await seekBar(page)).fill).toBe('rgb(255, 255, 255)');
});

for (const size of ['standard', 'large']) {
  test(`player size ${size}: the seek bar grows with the controls`, async ({ page }) => {
    await openPlayer(page, { 'player.layout': { preset: 'orbit', size: 'standard', timeline: 'line' } });
    const standard = (await seekBar(page)).track;
    await openPlayer(page, { 'player.layout': { preset: 'orbit', size, timeline: 'line' } });
    const now = (await seekBar(page)).track;
    if (size === 'standard') expect(now).toBe(standard);
    else expect(now).toBeGreaterThan(standard);
  });
}

for (const preset of PRESETS) {
  for (const size of ['standard', 'large']) {
    test(`${preset} (${size}): the docked Episodes list keeps clear of the seek bar and the top bar`, async ({ page }) => {
      await openPlayer(page, { 'player.layout': { preset, size }, 'player.episodes-docked': true });
      await page.mouse.move(900, 600);
      await page.getByRole('button', { name: /Episodes/ }).first().click();
      await expect(page.locator('.episode-dock')).toBeVisible();
      const overlaps = await page.evaluate(() => {
        const dock = document.querySelector('.episode-dock')!.getBoundingClientRect();
        // The mask fades the list's first and last 18px, so a few pixels of contact don't hide anything.
        const slack = 4;
        return [...document.querySelectorAll<HTMLElement>('.player .seek, .player-top .player-button, .player-top-end > *, .player-time')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            if (!box.width || getComputedStyle(el).visibility === 'hidden') return false;
            const across = box.right > dock.left && box.left < dock.right;
            return across && box.bottom > dock.top + slack && box.top < dock.bottom - slack;
          })
          .map((el) => el.getAttribute('aria-label') || el.className);
      });
      expect(overlaps).toEqual([]);
    });
  }
}
