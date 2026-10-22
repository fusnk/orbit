/**
 * Appearance settings under each theme style (crimson.css, afterglow.css, glass.css): a style dresses the
 * app but must not undo what the person picked, or turn unreadable on light colours of their own.
 */
import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
}

const set = (key: string, value: unknown) => `set.${key}=${encodeURIComponent(JSON.stringify(value))}`;

/** WCAG contrast of two `rgb(…)` colours. */
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

// A light theme of the person's own, made from the Crimson preset in Theme Studio (its style comes along).
const PALE = { id: 'mine-0a0b0c0d', name: 'Pale', fonts: 'inter', style: 'crimson', colors: { bg: '#f4f1ec', panel: '#ffffff', raised: '#ebe6df', text: '#1b1714', muted: '#5d554e', faint: '#8a8178', danger: '#c62828', accent: '#c8102e' } };

test('crimson style on light colours: the current page stays readable once the bar turns solid', async ({ page }) => {
  await openApp(page, ['room=library', set('theme.mine', [PALE]), set('theme', PALE.id), set('theme.layout', { position: 'top', side: 'start', align: 'start' })].join('&'));
  await page.locator('.outlet').evaluate((el) => {
    el.scrollTop = 600;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('.outlet.scrolled')).toHaveCount(1);
  const colors = await page.evaluate(() => ({
    text: getComputedStyle(document.querySelector('.nav-item.active')!).color,
    bar: getComputedStyle(document.querySelector('.titlebar')!).backgroundColor,
  }));
  expect(contrast(colors.text, colors.bar), JSON.stringify(colors)).toBeGreaterThan(4.5);
});

for (const theme of ['crimson', 'afterglow', 'glass']) {
  test(`Orbit Arc with the ${theme} theme keeps its short arc under the current page`, async ({ page }) => {
    await openApp(page, `look=arc&theme=${theme}`);
    const arc = await page.locator('.nav-indicator').first().evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { width: after.width, fill: getComputedStyle(el).backgroundColor };
    });
    expect(arc.width).toBe('24px');
    expect(arc.fill).toBe('rgba(0, 0, 0, 0)');
  });
}

for (const corners of ['sharp', 'classic', 'round'] as const) {
  test(`landscape cards follow the Corners setting (${corners})`, async ({ page }) => {
    await openApp(page, `room=home&${set('appearance', { rowStyle: 'landscape', corners })}`);
    const radius = await page.locator('.landscape-card .frame').first().evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    // Square-ish strips of art: sharp and classic as before (4px, 8px), round visibly rounder.
    expect(radius).toBe({ sharp: 4, classic: 8, round: 14 }[corners]);
  });
}

for (const [motion, os, lifts] of [['reduce', 'no-preference', false], ['full', 'reduce', true], ['system', 'reduce', false]] as const) {
  test(`profile tiles follow Motion: ${motion} (system asks for ${os})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: os });
    await openApp(page, `room=settings&${set('appearance', { motion })}`);
    await page.evaluate(async () => {
      const { openProfileSwitcher } = (await import('/src/rooms/profiles/picker.ts' as string)) as typeof import('../../src/rooms/profiles/picker');
      void openProfileSwitcher();
    });
    const tile = page.locator('.who.overlay .who-tile').first();
    await tile.hover();
    expect((await tile.evaluate((el) => getComputedStyle(el).transform)) !== 'none').toBe(lifts);
  });
}

test('Settings: choosing or removing a wallpaper keeps the keyboard focus on its row', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.locator('.settings-nav-item[data-category="appearance"]').click();
  const control = page.locator('.wallpaper-control:has(input[accept^="image/"])');
  await control.locator('button').first().focus();
  // A PNG's first bytes are all Rust checks; the picker's answer is handed over as the system's file dialog would.
  await control.locator('input[type="file"]').evaluate((input: HTMLInputElement) => {
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'wall.png', { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change'));
  });
  await expect(control.locator('button.danger')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('.wallpaper-control') !== null)).toBe(true);
  await control.locator('button.danger').focus();
  await page.keyboard.press('Enter');
  await expect(control.locator('button.danger')).toHaveCount(0);
  await expect(control.locator('button').first()).toBeFocused();
});

// One of the person's own themes saved from Theme Studio, carrying its Type & finish and its menu.
const NIGHT_RAIL = {
  id: 'mine-0e0f1a1b',
  name: 'Night Rail',
  fonts: 'inter',
  colors: { bg: '#0b0d12', panel: '#141821', raised: '#1c2230', text: '#f2f4f8', muted: '#a7afbf', faint: '#6b7385', danger: '#ff5c5c', accent: '#33c3ff' },
  appearance: { tint: false, glow: 'strong', corners: 'sharp', posterSize: 'large', heroStyle: 'split', detailBackground: 'normal' },
  layout: { position: 'rail', side: 'start', align: 'center', place: 'bottom', items: [] },
};

test('Settings: choosing a theme of your own shows the menu and Type & finish it brings, and keeps focus on its card', async ({ page }) => {
  await openApp(page, ['room=settings', 'set.settings.show-all=true', set('theme.mine', [NIGHT_RAIL])].join('&'));
  await page.locator('.settings-nav-item[data-category="appearance"]').click();
  const value = (label: string) => page.locator('.settings-pane .setting-row[data-compact]', { has: page.locator('.setting-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.setting-value-text');
  await expect(value('Where the menu lives')).toHaveText('Top bar');
  await page.locator('.my-themes .theme-card', { hasText: 'Night Rail' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.nav === 'rail');
  // The rows further down the page say what's on screen now, not what was there before the theme.
  await expect(value('Where the menu lives')).not.toHaveText('Top bar');
  await expect(value('Background glow from artwork')).not.toHaveText('Normal');
  await expect(value('Home banner')).not.toHaveText('Card');
  await expect(value('Corners')).not.toHaveText('Classic');
  await expect(page.locator('.my-themes .theme-card', { hasText: 'Night Rail' })).toBeFocused();
});

test('Settings: rows a theme choice drew over let go of the app-wide events they listened to', async ({ page }) => {
  await openApp(page, 'room=settings&set.settings.show-all=true');
  await page.locator('.settings-nav-item[data-category="appearance"]').click();
  const cdp = await page.context().newCDPSession(page);
  const listening = async (type: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
    return listeners.filter((listener) => listener.type === type).length;
  };
  const before = await listening('orbit:seekbar-shown');
  // Each choice draws the Colours section again, with a new "Player colour" row; no seek bar changes meanwhile.
  const presets = page.locator('.themes .theme-grid[role="group"] .theme-card');
  for (let i = 1; i <= 6; i++) {
    await presets.nth(i).click();
    await expect(presets.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  // The row on the page, and at most the one drawn over last (it was still on the page when the new one was made).
  expect(await listening('orbit:seekbar-shown')).toBeLessThanOrEqual(before + 1);
});
