/**
 * Where the player's controls end up on screen, in every Settings → Player layout.
 * These catch what only shows once a page is laid out (the unit tests read CSS as text):
 * a transport that moves when the controls fade, a panel whose contents touch its header
 * or spill past its sides.
 */
import { expect, test, type Page } from '@playwright/test';

/** layout.ts's PRESETS (importing it would pull its CSS into Node); the first test keeps them in step. */
const PRESETS = ['orbit', 'minimal', 'streaming', 'theater', 'cinema', 'compact', 'floating', 'tv', 'arc'];

/** The bars slide this far as they fade (player-polish.css); anything more is a jump. */
const IDLE_SLIDE = 8;

async function openPlayer(page: Page, layout: string): Promise<void> {
  // The idle timer runs on this clock, so a test can let it run out at once.
  await page.clock.install();
  await page.goto(`/tests/ui/player.html?layout=${layout}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  // End states only: a transition's last frame is where a control lands.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.player.started')).toBeVisible();
}

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} isn't on screen`);
  return found;
};

test('covers every player layout', async ({ page }) => {
  await page.goto('/tests/ui/player.html');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.presets)).toEqual(PRESETS);
});

for (const layout of PRESETS) {
  test.describe(layout, () => {
    test('the transport stays put when the controls fade', async ({ page }) => {
      await openPlayer(page, layout);
      const shown = await box(page, '.player-button.large');
      await page.clock.runFor(5000);
      await expect(page.locator('.player.idle')).toHaveCount(1);
      const idle = await box(page, '.player-button.large');
      expect(Math.abs(idle.x - shown.x), 'moved sideways').toBeLessThanOrEqual(1);
      expect(Math.abs(idle.y - shown.y), 'moved up or down').toBeLessThanOrEqual(IDLE_SLIDE + 1);
    });

    test("the settings panel's contents sit inside it, clear of its header", async ({ page }) => {
      await openPlayer(page, layout);
      await page.locator('.player-button[aria-label="Settings"]:visible, .player-button[aria-label="Playback & picture"]:visible').first().click();
      const panel = page.locator('.player-panel:not([hidden])');
      await expect(panel.locator('.hub-grid')).toBeVisible();
      const header = await box(page, '.player-panel:not([hidden]) .player-panel-header');
      const first = await box(page, '.player-panel:not([hidden]) .player-panel-body > :first-child');
      expect(first.y - (header.y + header.height), 'gap under the header').toBeGreaterThanOrEqual(6);
      const outside = await panel.evaluate((el) => {
        const edge = el.getBoundingClientRect();
        return [...el.querySelectorAll<HTMLElement>('.player-panel-body *')]
          .filter((child) => {
            const r = child.getBoundingClientRect();
            return r.width > 0 && (r.left < edge.left - 0.5 || r.right > edge.right + 0.5);
          })
          .map((child) => child.className || child.tagName);
      });
      expect(outside, 'past the panel sides').toEqual([]);
    });
  });
}
