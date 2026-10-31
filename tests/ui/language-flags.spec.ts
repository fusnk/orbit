/**
 * Flags next to language names: the player's Audio and Subtitles views and
 * the language settings.
 */
import { expect, test, type Page } from '@playwright/test';

const track = (id: number, kind: 'audio' | 'sub', lang: string | null, extra: Record<string, unknown> = {}) => ({
  id, kind, title: null, lang, codec: kind === 'audio' ? 'eac3' : 'subrip', channels: kind === 'audio' ? 6 : null,
  selected: false, secondary: false, external: false, default: false, forced: false, ...extra,
});

const TRACKS = [
  track(1, 'audio', 'jpn', { selected: true, default: true, title: 'Original' }),
  track(2, 'audio', 'eng', { channels: 2 }),
  track(3, 'audio', 'spa', { title: 'Castellano' }),
  track(4, 'audio', 'es-419', { title: 'Latino' }),
  track(5, 'audio', null, { title: 'Commentary', channels: 2 }),
  track(1, 'sub', 'eng', { selected: true, default: true }),
  track(2, 'sub', 'pob'),
  track(3, 'sub', 'fre'),
  track(4, 'sub', 'ger'),
  track(5, 'sub', 'ara'),
  track(6, 'sub', 'zht'),
  track(7, 'sub', 'kor'),
  track(8, 'sub', 'heb'),
  track(9, 'sub', 'ukr'),
  track(10, 'sub', 'und'),
];

const send = (page: Page, event: Record<string, unknown>) =>
  page.evaluate(async (e) => {
    const open = window.orbitTest.calls.filter(([cmd]) => cmd === 'player_open').at(-1);
    await window.orbitTest.emit('player://event', { load: (open?.[1] as { load: number }).load, ...e });
  }, event);

async function openPlayer(page: Page, look = 'orbit'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/tests/ui/app.html?look=${look}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.evaluate(() => window.orbitTest.openPlayer('Blackwater County'));
  await expect(page.locator('.player.started')).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await send(page, { kind: 'tracks', tracks: TRACKS });
}

/** Each row's flag (its file name, or '' for an empty slot) and where its name starts. */
const flagRows = (page: Page, rows: string) =>
  page.locator(rows).evaluateAll((els) =>
    els.map((el) => {
      const slot = el.querySelector('.language-flag');
      const img = slot?.querySelector('img');
      const label = el.querySelector('.panel-row-label') ?? el;
      return {
        flag: slot ? ((slot as HTMLElement).dataset.flag ?? '') : null,
        loaded: img ? img.complete && img.naturalWidth > 0 : true,
        x: Math.round(label.getBoundingClientRect().left),
      };
    }),
  );

for (const look of ['orbit', 'glass', 'couch']) {
  test(`Audio and Subtitles show each language's flag, names lined up (${look})`, async ({ page }) => {
    await openPlayer(page, look);
    await page.keyboard.press('c');
    await page.locator('[data-focus-id="hub-audio"]').click();
    await page.waitForTimeout(300);
    const audio = await flagRows(page, '.player-panel:not([hidden]) [data-focus-id^="audio-"]');
    expect(audio.map((r) => r.flag)).toEqual(['jp', 'us', 'es', 'mx', '']);
    expect(audio.every((r) => r.loaded)).toBe(true);
    expect(new Set(audio.map((r) => r.x)).size).toBe(1);

    await page.locator('.player-panel:not([hidden]) .player-panel-header button').first().click();
    await page.locator('[data-focus-id="hub-subtitles"]').click();
    await page.waitForTimeout(300);
    const subs = await flagRows(page, '.player-panel:not([hidden]) [data-focus-id^="lang-"]');
    expect(subs.map((r) => r.flag)).toEqual(expect.arrayContaining(['us', 'br', 'fr', 'de', 'sa', 'tw', 'kr', 'il', 'ua', '']));
    expect(subs.every((r) => r.loaded)).toBe(true);
    expect(new Set(subs.map((r) => r.x)).size).toBe(1);
    // Off, Upload and the other rows that aren't a language carry no flag slot.
    await expect(page.locator('.player-panel:not([hidden]) [data-focus-id="sub-off"] .language-flag')).toHaveCount(0);

    // The second line lists each track with its flag too.
    await expect(page.locator('.player-panel:not([hidden]) [data-focus-id="sub2-2"] .language-flag')).toHaveAttribute('data-flag', 'br');
  });
}

test('the language settings show flags in the values, the list and the menus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true&set.player.subtitle-language=["en","pt-BR","zh-Hant"]&set.player.audio-language="ja"');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(() => window.orbitTest.ready);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.locator('.settings-nav-item[data-category="subtitles"]').click();
  await page.waitForTimeout(400);
  const list = await flagRows(page, '.language-list-name');
  expect(list.map((r) => r.flag)).toEqual(['us', 'br', 'tw']);
  await page.locator('.language-list').scrollIntoViewIfNeeded();

  await page.locator('.language-list [data-focus-id="add"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-item .language-flag img').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.settings-nav-item[data-category="picture-sound"]').click();
  const audio = page.locator('button.setting-value[aria-label="Preferred audio language"]');
  await expect(audio).toContainText('Japanese');
  await audio.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-item[aria-checked="true"] .language-flag')).toHaveAttribute('data-flag', 'jp');
});
