/**
 * The app shell: the title bar and its nav in every Look, at narrow and wide windows, in a
 * language with long names (German) and a right-to-left one (Arabic).
 */
import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

/** Looks whose nav sits in the title bar's row, between the wordmark and the avatar. */
const BAR_LOOKS = ['orbit', 'crimson', 'premiere', 'afterglow', 'arc'];

for (const look of BAR_LOOKS) {
  test(`${look}: the title bar's nav keeps clear of the wordmark and the avatar`, async ({ page }) => {
    const found: string[] = [];
    for (const lang of ['en', 'de', 'ar']) {
      await openApp(page, `look=${look}&lang=${lang}&room=movies`);
      for (const width of [900, 1100, 1280, 1920]) {
        await page.setViewportSize({ width, height: 720 });
        // nav.ts picks icons-only a frame after a resize.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const gaps = await page.evaluate(() => {
          const nav = document.querySelector('.titlebar nav.nav')!.getBoundingClientRect();
          const neighbours = [...document.querySelectorAll<HTMLElement>('.titlebar-start > *, .titlebar-tools > *')].filter((el) => el.offsetWidth > 0 && getComputedStyle(el).visibility !== 'hidden');
          return neighbours.map((el) => {
            const box = el.getBoundingClientRect();
            return { name: el.className, gap: Math.round(Math.max(box.left - nav.right, nav.left - box.right)) };
          });
        });
        for (const { name, gap } of gaps) if (gap < 8) found.push(`${lang} ${width}px: ${gap}px to .${name}`);
      }
    }
    expect(found).toEqual([]);
  });
}

test("Orbit Arc: the avatar, bell and Quick settings capsule sits inside the bar, off the window's top edge", async ({ page }) => {
  await openApp(page, 'look=arc&room=movies');
  const { capsule, bar } = await page.evaluate(() => ({
    capsule: document.querySelector('.titlebar-tools')!.getBoundingClientRect().toJSON() as DOMRect,
    bar: document.querySelector('.titlebar')!.getBoundingClientRect().toJSON() as DOMRect,
  }));
  expect(capsule.top).toBeGreaterThanOrEqual(bar.top + 4);
  expect(capsule.bottom).toBeLessThanOrEqual(bar.bottom - 4);
});

for (const look of BAR_LOOKS) {
  test(`${look}: a nav item's focus ring isn't cut off by the scrolling nav`, async ({ page }) => {
    await openApp(page, `look=${look}&room=movies`);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Back, the wordmark, then the current page's nav item (roving tabindex).
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    await expect(page.locator('.nav-item.active')).toBeFocused();
    const cut = await page.evaluate(() => {
      const item = document.activeElement!;
      // How far the ring reaches outside the item: the widest outer (not inset) box-shadow spread.
      const outer = getComputedStyle(item)
        .boxShadow.split(/,(?![^(]*\))/)
        .filter((shadow) => !shadow.includes('inset'))
        .map((shadow) => Number(shadow.match(/(-?[\d.]+)px\s*$/)?.[1] ?? 0));
      const reach = Math.max(0, ...outer);
      const b = item.getBoundingClientRect();
      const nav = item.closest('nav')!.getBoundingClientRect();
      return Math.max(nav.left - (b.left - reach), b.right + reach - nav.right, nav.top - (b.top - reach), b.bottom + reach - nav.bottom);
    });
    expect(cut, 'px of the ring outside the nav, which clips it').toBeLessThanOrEqual(0);
  });
}

/** How far the focused element and its ring (outer box-shadow or outline) reach outside `container`'s visible box. */
async function ringOutside(page: Page, container: string): Promise<number> {
  return page.evaluate((container) => {
    const el = document.activeElement!;
    const cs = getComputedStyle(el);
    const shadows = cs.boxShadow
      .split(/,(?![^(]*\))/)
      .filter((shadow) => shadow !== 'none' && !shadow.includes('inset'))
      .map((shadow) => Number(shadow.match(/(-?[\d.]+)px\s*$/)?.[1] ?? 0));
    const outline = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
    const reach = Math.max(0, outline, ...shadows);
    const b = el.getBoundingClientRect();
    const box = document.querySelector(container)!.getBoundingClientRect();
    return Math.max(box.left - (b.left - reach), b.right + reach - box.right, box.top - (b.top - reach), b.bottom + reach - box.bottom);
  }, container);
}

test('Quick settings: Tab past either end brings the control it wraps to into view, ring and all', async ({ page }) => {
  // Short enough that the panel scrolls.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'room=movies');
  await page.locator('.settings-button').click();
  await expect(page.locator('.quick-panel')).toBeVisible();
  const found: string[] = [];
  // Through every control and around to the first again, then back the other way.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(key);
      const outside = await ringOutside(page, '.quick-panel');
      if (outside > 0) found.push(`${key} ${i}: ${await page.evaluate(() => document.activeElement!.textContent)} ${outside}px outside`);
    }
  }
  expect(found).toEqual([]);
});

test('Quick settings opens under its button in a short window, clear of the title bar', async ({ page }) => {
  // Taller than the room under the button: it scrolls there rather than climbing over the button and the window's own buttons.
  for (const [width, height] of [[1280, 720], [960, 600]] as const) {
    await page.setViewportSize({ width, height });
    await openApp(page, 'room=movies');
    await page.locator('.settings-button').click();
    await expect(page.locator('.quick-panel')).toBeVisible();
    const gap = await page.evaluate(() => {
      const panel = document.querySelector('.quick-panel')!.getBoundingClientRect();
      const under = (sel: string) => Math.round(panel.top - document.querySelector(sel)!.getBoundingClientRect().bottom);
      return { button: under('.settings-button'), caption: under('.titlebar .caption'), bottom: Math.round(innerHeight - panel.bottom) };
    });
    expect(gap.button, `${width}×${height}: under its button`).toBeGreaterThanOrEqual(0);
    expect(gap.caption, `${width}×${height}: under the window's buttons`).toBeGreaterThanOrEqual(0);
    expect(gap.bottom, `${width}×${height}: inside the window`).toBeGreaterThanOrEqual(0);
  }
});

test("Nav: a tooltip only where the page's name isn't shown", async ({ page }) => {
  // Five page loads, each a few seconds of unbundled modules from Vite: more than the default 30s on a busy runner.
  test.slow();
  const found: string[] = [];
  // Names shown: the top bar, the sidebar, the pill; icons only: the rail, a narrow top bar.
  for (const [look, width, named] of [
    ['orbit', 1280, true],
    ['couch', 1280, true],
    ['glass', 1280, true],
    ['marquee', 1280, false],
    ['orbit', 900, false],
  ] as const) {
    await page.setViewportSize({ width, height: 720 });
    await openApp(page, `look=${look}&room=movies`);
    const item = page.locator('.nav-item[data-room="series"]');
    await item.hover();
    const title = await item.getAttribute('title');
    if (named && title) found.push(`${look} ${width}px: "${title}" repeats the name beside it`);
    if (!named && !title) found.push(`${look} ${width}px: no tooltip on an icon`);
  }
  expect(found).toEqual([]);
});

const LOOKS = ['orbit', 'crimson', 'marquee', 'premiere', 'glass', 'aurora', 'couch', 'afterglow', 'arc'];

/** The nav items and title bar buttons that `selector`'s box overlaps. */
async function covered(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    const hits: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('nav.nav .nav-item, .titlebar-start > *, .titlebar-tools > *')) {
      if (el.offsetWidth === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (Math.min(b.right, box.right) > Math.max(b.left, box.left) && Math.min(b.bottom, box.bottom) > Math.max(b.top, box.top)) hits.push(el.className);
    }
    return hits;
  }, selector);
}

for (const look of LOOKS) {
  test(`${look}: the offline and update banners keep clear of the nav, in both directions`, async ({ page }) => {
    // Four page loads (two languages, two widths): close to the default 30s on a busy runner.
    test.slow();
    const found: string[] = [];
    for (const lang of ['en', 'ar']) {
      for (const width of [1280, 900]) {
        await page.setViewportSize({ width, height: 720 });
        await page.context().setOffline(false);
        await openApp(page, `look=${look}&lang=${lang}&room=movies`);
        await page.context().setOffline(true);
        await expect(page.locator('.offline-banner:not(.update-banner)')).toBeVisible();
        for (const hit of await covered(page, '.offline-banner:not(.update-banner)')) found.push(`${lang} ${width}px: offline banner under .${hit}`);
        await page.context().setOffline(false);
        await page.evaluate(() => window.orbitTest.emit('update-ready', { version: '9.9.9' }));
        await expect(page.locator('.update-banner')).toBeVisible();
        for (const hit of await covered(page, '.update-banner')) found.push(`${lang} ${width}px: update banner under .${hit}`);
      }
    }
    expect(found).toEqual([]);
  });

  test(`${look}: a toast keeps clear of the nav`, async ({ page }) => {
    await openApp(page, `look=${look}&room=movies`);
    await page.evaluate(async () => {
      const { toast } = (await import('/src/components/toast.ts' as string)) as typeof import('../../src/components/toast');
      toast('Removed “The Lighthouse Keeper’s Cat” from My Library', { action: { label: 'Undo', run() {} } });
    });
    await expect(page.locator('.toast.show')).toBeVisible();
    // Where it settles after sliding up: its transition's end, not a guess at how long that takes.
    await page.locator('.toast').evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    expect(await covered(page, '.toast')).toEqual([]);
  });
}
