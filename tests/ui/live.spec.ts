/**
 * Live TV laid out in Chromium (app-fixture.ts): the guide grid scrolls inside its own
 * box at every width, including the narrow layout (groups above the channels), which a
 * window at its smallest size reaches under a large interface scale.
 */
import { expect, test } from '@playwright/test';

// The fixture can't zoom the webview, so Couch's 150% at the smallest window (960×600) is a 640×400 page.
for (const [look, width, height] of [['couch', 640, 400], ['orbit', 1280, 720]] as const) {
  test(`the guide stays inside the window and opens on now (${look}, ${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/tests/ui/app.html?room=live&look=${look}&set.live.view="guide"`);
    await page.waitForFunction(() => 'orbitTest' in window);
    expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
    const outside = await page.locator('.room.live').evaluate((room) =>
      [...room.querySelectorAll<HTMLElement>('.live-header, .live-tools > *, .live-groups, .guide-detail, .guide-days, .guide-scroller')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5)
        .map((el) => el.className),
    );
    expect(outside, 'past the window').toEqual([]);
    if (width >= 1280) {
      // With room for them, the tools sit on one line.
      const tops = await page.locator('.live-tools > :not([hidden])').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));
      expect(new Set(tops).size, 'tools on one line').toBe(1);
    }
    // The hint before a programme is chosen ends inside its box, not cut through a line.
    const hint = await page.locator('.guide-detail').evaluate((detail) => {
      const text = detail.querySelector('.muted')!.getBoundingClientRect();
      return { text: text.bottom, box: detail.getBoundingClientRect().bottom - parseFloat(getComputedStyle(detail).paddingBottom) };
    });
    expect(hint.text, 'hint ends inside its box').toBeLessThanOrEqual(hint.box + 0.5);
    // The line for now is in view, which it can only be if the grid scrolls in its box.
    const now = await page.locator('.guide-now').boundingBox();
    const box = await page.locator('.guide-scroller').boundingBox();
    expect(now && box && now.x > box.x && now.x < box.x + box.width, 'now is in view').toBe(true);
  });
}

// Couch on a small window (the smallest, a 640×400 page at 150%): the details line was cut to "YES Network ·…", the time lost.
test("a programme's time stays in sight on a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/tests/ui/app.html?room=live&look=couch&set.live.view="guide"');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.locator('.guide-cell').first().focus();
  const when = page.locator('.guide-detail-when');
  await expect(when).toBeVisible();
  const time = await when.evaluate((el) => {
    const text = el.firstChild!;
    const at = /\d{1,2}:\d{2}/.exec(text.textContent!);
    if (!at) return null;
    const range = document.createRange();
    range.setStart(text, at.index);
    range.setEnd(text, at.index + at[0].length);
    return { end: range.getBoundingClientRect().right, box: el.getBoundingClientRect().right };
  });
  expect(time, 'a time in the line').not.toBeNull();
  expect(time!.end, 'the time is inside the visible line').toBeLessThanOrEqual(time!.box);
});

test("a live channel's player covers the window, whatever order the styles load in", async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=live');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.locator('.live-row').first().click();
  const player = page.locator('.player.live');
  await expect(player).toBeVisible({ timeout: 10_000 });
  // The release build bundled styles.css after player.css (dev loads them the other way round): load it last here too.
  await page.evaluate(() => {
    const main = [...document.querySelectorAll('style[data-vite-dev-id]')].find((s) => /[/]src[/]styles[.]css$/.test(s.getAttribute('data-vite-dev-id') ?? ''));
    if (!main) throw new Error('styles.css not found');
    document.head.append(main);
  });
  // The Live TV page and the live player share the class `live`: page rules must not reach the player.
  const box = await player.evaluate((el) => ({ position: getComputedStyle(el).position, height: el.getBoundingClientRect().height, window: innerHeight }));
  expect(box.position).toBe('fixed');
  expect(box.height).toBe(box.window);
});

// A programme of a minute or two gets a cell a few px wide (5px a minute): its padding made it at least 20px,
// over the start of the next programme's cell.
test("a short programme's cell is no wider than its time", async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=live&set.live.view="guide"');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  const cell = page.locator('.guide-cell:not(.empty)').first();
  await expect(cell).toBeVisible();
  const width = await cell.evaluate((el) => {
    el.style.setProperty('--w', '4px');
    return el.getBoundingClientRect().width;
  });
  expect(width).toBeLessThanOrEqual(4);
});

// With no source, or channels that couldn't be read, the page has no groups: the message took only their 240px column.
for (const [state, fault] of [['no source', 'fail.iptv_sources=empty'], ['channels unreadable', 'fail.iptv_channels=error']] as const) {
  test(`the message for ${state} spans the page`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/ui/app.html?room=live&${fault}`);
    await page.waitForFunction(() => 'orbitTest' in window);
    await page.evaluate(() => window.orbitTest.ready);
    const message = page.locator('.live-body > .state-message');
    await expect(message).toBeVisible();
    const [box, body] = await Promise.all([message.boundingBox(), page.locator('.live-body').boundingBox()]);
    expect(box!.width).toBeGreaterThan(body!.width - 1);
    await expect(message.getByRole('button')).toBeVisible();
  });
}

test("the guide says when it couldn't be read, or has no programmes, with a way on", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const open = async (fault: string) => {
    await page.goto(`/tests/ui/app.html?room=live&set.live.view="guide"&${fault}`);
    await page.waitForFunction(() => 'orbitTest' in window);
    await page.evaluate(() => window.orbitTest.ready);
  };
  await open('fail.iptv_schedule=error');
  // Try again keeps its own size beside the line (it stretched across the box).
  const retry = page.locator('.guide-detail').getByRole('button', { name: 'Try again' });
  expect((await retry.boundingBox())!.width).toBeLessThan(200);
  // No programmes at all (a playlist without a guide): not "Choose a programme", but where to add a guide.
  await open('fail.iptv_schedule=empty');
  await expect(page.locator('.guide-detail')).toContainText('No guide for these channels yet');
  await page.locator('.guide-detail').getByRole('button', { name: 'Add guide' }).click();
  await expect(page.locator('.live-tv-section')).toBeVisible();
});

test('while the channels are read, the page shows placeholders, then the channels', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=live&fail.iptv_channels=slow:3000');
  await page.waitForFunction(() => 'orbitTest' in window);
  // It was an empty page until they came.
  await expect(page.locator('.live-body .live-row-skeleton').first()).toBeVisible();
  await expect(page.locator('.live-row').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.live-body .skeleton')).toHaveCount(0);
});

test('a source the provider refuses while adding it says to check its details, not to remove it', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=live&fail.iptv_add=error:err.iptv.refused');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(async () => {
    const { openSettingsTo } = (await import('/src/rooms/settings/index.ts' as string)) as { openSettingsTo(place: string): void };
    openSettingsTo('livetv');
    await window.orbitTest.go('settings');
  });
  const form = page.locator('.live-tv-section .tv-add');
  for (const [label, value] of [['Name', 'My TV'], ['Playlist address', 'https://tv.example/list.m3u']] as const) {
    const field = form.getByRole('textbox', { name: label, exact: true });
    await field.click();
    await field.fill(value);
  }
  await form.getByRole('button', { name: 'Add source' }).click();
  await expect(form.locator('.provider-message')).toHaveText(/didn’t accept this/);
});

// The guide's channels scroll inside it: picking another group drew the new group's channels as far down as the
// last group had been scrolled (at the bottom, the new group opened at its bottom too).
test('picking another group starts the guide at its first channel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tests/ui/app.html?room=live&tv-many&set.live.view="guide"');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  const scroller = page.locator('.guide-scroller');
  await page.locator('.live-group').nth(1).click();
  await page.evaluate(() => window.orbitTest.settled());
  await expect(page.locator('.guide-row').first()).toBeVisible();
  const scrolled = await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled, 'a group of this size scrolls in the guide').toBeGreaterThan(0);
  await page.locator('.live-group').nth(2).click();
  await page.evaluate(() => window.orbitTest.settled());
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
});
