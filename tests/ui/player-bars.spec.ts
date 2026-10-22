/**
 * The player's control bars with each Settings → Player background. A plate (Blur, or Floating's
 * panel) has an edge on screen, so the controls it holds must sit inside it: one poking past it
 * floats half on the picture and half on a letterboxed film's black bar.
 */
import { expect, test, type Page } from '@playwright/test';

const PRESETS = ['orbit', 'minimal', 'streaming', 'theater', 'cinema', 'compact', 'floating', 'tv', 'arc'];

async function openPlayer(page: Page, layout: string, bg: string): Promise<void> {
  await page.goto(`/tests/ui/player.html?layout=${layout}&bg=${bg}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.player.started')).toBeVisible();
}

/** Controls in the bottom bar drawn outside the plate's box (their own class names). */
const outsidePlate = (page: Page) =>
  page.locator('.player-bottom').evaluate((plate) => {
    const edge = plate.getBoundingClientRect();
    return [...plate.querySelectorAll<HTMLElement>('button, .player-time, .seek')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden]')) return false;
        // Moved off the bar on purpose: Streaming's and Cinema's transport to the middle, Cinema's Mute and Full screen to the top.
        if (r.bottom < innerHeight / 2 + 120) return false;
        return r.top < edge.top - 0.5 || r.bottom > edge.bottom + 0.5 || r.left < edge.left - 0.5 || r.right > edge.right + 0.5;
      })
      .map((el) => el.getAttribute('aria-label') || el.className);
  });

for (const layout of PRESETS) {
  for (const size of ['standard', 'large']) {
    test(`${layout} (${size}): the blur plate holds every control, hovered`, async ({ page }) => {
      await page.goto('about:blank');
      await openPlayer(page, layout, 'blur');
      if (size === 'large') await page.locator('.player').evaluate((el) => (el.dataset.size = 'large'));
      const bar = await page.locator('.player-bottom').boundingBox();
      await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height - 10);
      expect(await outsidePlate(page)).toEqual([]);
    });
  }
}

for (const layout of PRESETS) {
  test(`${layout}: the bottom bar draws the background Settings picked`, async ({ page }) => {
    const drawn = () => page.locator('.player-bottom').evaluate((el) => ({ image: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).backgroundColor }));
    await openPlayer(page, layout, 'none');
    expect(await drawn(), 'None: no shade').toEqual({ image: 'none', color: 'rgba(0, 0, 0, 0)' });
    await openPlayer(page, layout, 'blur');
    const blur = await drawn();
    expect(blur.image, 'Blur: a plate, not a fade').toBe('none');
    expect(Number(blur.color.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? 1), 'Blur: the plate is drawn').toBeGreaterThan(0.5);
  });
}

for (const layout of PRESETS) {
  test(`${layout} (large): the settings panel stays below the top bar`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openPlayer(page, layout, 'gradient');
    await page.locator('.player').evaluate((el) => (el.dataset.size = 'large'));
    await page.locator('.player-button[aria-label="Settings"]:visible, .player-button[aria-label="Playback & picture"]:visible').first().click();
    const top = (await page.locator('.player-top').boundingBox())!;
    const panel = (await page.locator('.player-panel:not([hidden])').boundingBox())!;
    expect(panel.y, 'panel top under the top bar').toBeGreaterThanOrEqual(top.y + top.height);
  });
}

for (const layout of PRESETS) {
  for (const size of ['standard', 'large']) {
    test(`${layout} (${size}): the end-credits Next Up card keeps clear of the top and bottom bars`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openPlayer(page, layout, 'gradient');
      if (size === 'large') await page.locator('.player').evaluate((el) => (el.dataset.size = 'large'));
      // The card as the end credits show it (next-up-controller.ts), with its art and buttons.
      await page.locator('.next-up').evaluate((card: HTMLElement) => {
        card.hidden = false;
        card.classList.add('takeover');
      });
      const card = (await page.locator('.next-up').boundingBox())!;
      const topControls = await page.locator('.player-top').evaluate((top) =>
        Math.max(...[...top.querySelectorAll<HTMLElement>('button, .player-name, .layout-badges')].filter((el) => el.offsetWidth > 0).map((el) => el.getBoundingClientRect().bottom)),
      );
      const clear = await page.locator('.player').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--player-clear')) || 0);
      expect(card.y, 'below the top bar').toBeGreaterThanOrEqual(topControls);
      expect(card.y + card.height, 'above the bottom bar').toBeLessThanOrEqual(720 - clear + 1);
    });
  }
}

for (const bg of ['none', 'gradient', 'blur']) {
  test(`streaming (${bg}): the title block sits clear of the top bar and reads on a bright picture`, async ({ page }) => {
    await openPlayer(page, 'streaming', bg);
    await expect(page.locator('.player.layout-info-on')).toHaveCount(1);
    const top = (await page.locator('.player-top').boundingBox())!;
    const title = (await page.locator('.layout-info-title').boundingBox())!;
    expect(title.y - (top.y + top.height), 'gap under the top bar').toBeGreaterThanOrEqual(8);
    expect(await page.locator('.layout-info-title').evaluate((el) => getComputedStyle(el).textShadow)).not.toBe('none');
  });
}

for (const layout of PRESETS) {
  test(`${layout}: with every button showing, the bottom bar's controls never overlap, at any window width`, async ({ page }) => {
    await openPlayer(page, layout, 'gradient');
    // A series' fullest bar: next, episodes, queue, shuffle, and the rest (the film here has fewer).
    await page.locator('.player-bar-end').evaluate((end) => {
      for (const el of end.querySelectorAll<HTMLElement>(':scope > [hidden]')) el.hidden = false;
    });
    const overlaps = () =>
      page.locator('.player-bar').evaluate((bar) => {
        const items = [...bar.querySelectorAll<HTMLElement>('button, .player-name')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]') && !(el.matches('button') && el.closest('.player-name'));
        });
        const name = (el: HTMLElement) => el.getAttribute('aria-label') || el.className;
        const found: string[] = [];
        items.forEach((one, i) => {
          for (const other of items.slice(i + 1)) {
            if (one.contains(other) || other.contains(one)) continue;
            const a = one.getBoundingClientRect();
            const b = other.getBoundingClientRect();
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) found.push(`${name(one)} / ${name(other)}`);
          }
        });
        return found;
      });
    for (let width = 900; width <= 1920; width += 40) {
      await page.setViewportSize({ width, height: 800 });
      // The bar is measured as it resizes (ResizeObserver, before the frame is drawn): checked once that's run.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      expect(await overlaps(), `at ${width}px`).toEqual([]);
      // Hovered, the volume slider opens beside the mute button.
      await page.locator('.player-volume').hover();
      expect(await overlaps(), `at ${width}px, the volume slider open`).toEqual([]);
      await page.mouse.move(0, 0);
    }
  });
}

test('arc: on a wide window the capsule stays centred, the end buttons well clear of it', async ({ page }) => {
  await openPlayer(page, 'arc', 'gradient');
  await page.locator('.player-bar-end').evaluate((end) => {
    for (const el of end.querySelectorAll<HTMLElement>(':scope > [hidden]')) el.hidden = false;
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.player')).not.toHaveAttribute('data-cramped');
  const play = (await page.locator('.player-bar-start > .large').boundingBox())!;
  expect(Math.abs(play.x + play.width / 2 - 960)).toBeLessThan(1);
});
