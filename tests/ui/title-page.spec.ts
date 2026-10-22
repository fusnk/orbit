/**
 * The title page (app-fixture.ts), in every Look: its sections' layout invariants.
 */
import { expect, test, type Page } from '@playwright/test';

/** src/theme/looks.ts LOOK_IDS (importing it here would bring the app's CSS into Node). */
const LOOK_IDS = ['orbit', 'crimson', 'marquee', 'premiere', 'glass', 'aurora', 'couch', 'afterglow', 'arc'];

async function openTitle(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
}

/** Each scroll arrow that can be pressed, and whether its row has more that way. */
const arrows = (page: Page) =>
  page.locator('.outlet').evaluate((outlet) =>
    [...outlet.querySelectorAll<HTMLElement>('.rail-arrows .rail-scroll')]
      .filter((button) => button.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && getComputedStyle(button).pointerEvents !== 'none')
      .map((button) => {
        const section = button.closest<HTMLElement>('.rail') ?? button.closest('.cast-header')!.parentElement!;
        const row = section.querySelector<HTMLElement>(':scope > .scroll-fade, :scope > .rail-track')!;
        const back = button === button.parentElement!.firstElementChild;
        return { section: section.className, back, more: row.classList.contains(back ? 'more-before' : 'more-after') };
      }),
  );

for (const look of LOOK_IDS) {
  for (const name of ['The Last Harbor', 'Blackwater County']) {
    // A row that fits has no arrows, and an arrow is live only where there's more that way, as on Home's rows.
    test(`${look}: ${name}'s scroll arrows only where its row scrolls`, async ({ page }) => {
      await openTitle(page, `look=${look}&title=${encodeURIComponent(name)}`);
      // Over each section, as the mouse would be (Home's rows show theirs on hover).
      for (const section of await page.locator('.outlet :is(.detail-cast, .detail-media, .rail)').filter({ visible: true }).all()) {
        await section.hover();
        for (const arrow of await arrows(page)) expect(arrow, `an arrow in ${arrow.section}`).toMatchObject({ more: true });
      }
    });
  }
}

// The classic banner's credits (Director, Starring) keep their own width, under the buttons when the banner is narrow,
// never squeezed into what the text column leaves (a word a line) by a narrow window, a side menu or a larger scale.
for (const look of ['orbit', 'glass', 'aurora', 'couch', 'arc']) {
  for (const [width, height] of [[900, 700], [1280, 720], [1920, 1080]] as const) {
    test(`${look} at ${width}×${height}: the banner's credits keep their width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openTitle(page, `look=${look}&title=${encodeURIComponent('The Last Harbor')}`);
      const { credits, room } = await page.locator('.detail:not(.showcase) .detail-content').evaluate((content) => {
        const style = getComputedStyle(content);
        const inner = content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return { credits: Math.round(content.querySelector('.detail-credits')!.getBoundingClientRect().width), room: Math.round(Math.min(inner, 300)) };
      });
      expect(credits).toBe(room);
    });
  }
}

test("a cast that runs past the window keeps its forward arrow", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openTitle(page, `title=${encodeURIComponent('The Last Harbor')}`);
  await page.locator('.detail-cast').hover();
  const live = await arrows(page);
  expect(live.filter((a) => a.section.includes('detail-cast'))).toEqual([{ section: 'detail-cast', back: false, more: true }]);
});

// A name with no break in it (addons that list file names send these) wraps inside the banner instead of running past it.
for (const layout of ['classic', 'showcase']) {
  test(`${layout}: a name with no break in it stays in the banner`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openTitle(page, `odd-titles&set.appearance=${encodeURIComponent(JSON.stringify({ detailLayout: layout }))}&title=tt9300003`);
    const title = page.locator('.outlet .detail-title').filter({ visible: true });
    const { overflow, right, banner } = await title.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      right: el.getBoundingClientRect().right,
      banner: el.closest('.detail-content')!.getBoundingClientRect().right,
    }));
    expect(overflow).toBe(0);
    expect(right).toBeLessThanOrEqual(banner);
  });
}

// TMDB's network and studio logos above the name (who airs or made it) show in both layouts.
for (const layout of ['classic', 'showcase']) {
  test(`${layout}: the network and studio logos show above the name`, async ({ page }) => {
    await openTitle(page, `set.appearance=${encodeURIComponent(JSON.stringify({ detailLayout: layout }))}&title=${encodeURIComponent('Blackwater County')}`);
    const logo = page.locator('.outlet .title-logos img').filter({ visible: true }).first();
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth > 0 && img.getBoundingClientRect().height > 0)).toBe(true);
  });
}

// Details that fail to load (an addon that took too long here) keep the catalog's preview on the page, with a note and Try again.
for (const layout of ['classic', 'showcase']) {
  test(`${layout}: details that don't load keep the preview, with a note and Try again`, async ({ page }) => {
    await openTitle(page, `fail.addon_request:/meta/=timeout&set.appearance=${encodeURIComponent(JSON.stringify({ detailLayout: layout }))}&title=${encodeURIComponent('The Last Harbor')}`);
    const note = page.locator('.outlet .detail-failure').filter({ visible: true });
    await expect(note).toContainText('Couldn’t load all the details');
    await expect(note.getByRole('button', { name: 'Try again' })).toBeVisible();
    // The banner is still the title's, and a film can still be played.
    await expect(page.locator('.outlet .detail-hero').filter({ visible: true }).getByRole('heading', { name: 'The Last Harbor', level: 1 })).toBeVisible();
    await expect(page.locator('.outlet .detail-hero [data-focus-id="play"]').filter({ visible: true })).toBeEnabled();
  });
}
