/**
 * Skip intro / recap / credits under each theme style: once prominent (graduated.css) it's a solid pill whose
 * label reads clearly. A style that dresses the player's floating plates (glass.css) must not turn it back
 * into a dark plate under the dark label, which looks greyed out.
 */
import { expect, test, type Page } from '@playwright/test';

/** WCAG contrast of two `rgb(…)` colours (alpha ignored). */
function contrast(a: string, b: string): number {
  const lum = (rgb: string) => {
    const [r, g, bl] = rgb.match(/[\d.]+/g)!.slice(0, 3).map((n) => {
      const c = Number(n) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

async function openPlayer(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/player.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => window.orbitTest.start());
  await expect(page.locator('.player.started')).toBeVisible();
}

// The Glass Look plays in the floating layout on a blurred bar (looks.ts).
for (const query of ['', 'theme=crimson', 'theme=afterglow', 'theme=glass', 'theme=glass&layout=floating&bg=blur']) {
  test(`a prominent Skip button is solid and readable (${query || 'default theme'})`, async ({ page }) => {
    await openPlayer(page, query);
    const skip = page.locator('.skip-segment');
    // As skip-controller.ts shows it a few seconds into an intro.
    await skip.evaluate((el: HTMLElement) => {
      el.hidden = false;
      el.textContent = 'Skip intro';
      el.dataset.prominence = 'prominent';
    });
    const colors = await skip.evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-light)';
      el.append(probe);
      const light = getComputedStyle(probe).color;
      probe.remove();
      return { text: style.color, fill: style.backgroundColor, light };
    });
    expect(colors.fill, JSON.stringify(colors)).toBe(colors.light);
    expect(contrast(colors.text, colors.fill), JSON.stringify(colors)).toBeGreaterThan(4.5);
  });
}
