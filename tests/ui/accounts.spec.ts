/**
 * Settings → Accounts & Services signed in to everything (app-fixture.ts `signed-in`: made-up
 * accounts): every row's controls end at the same edge as their neighbours', whatever the
 * section, and nothing reaches past the window.
 */
import { expect, test } from '@playwright/test';

for (const [name, query, width] of [
  ['English', '', 1280],
  ['German, narrow', 'lang=de', 900],
  ['Arabic', 'lang=ar', 1280],
] as const) {
  test(`signed-in rows line up with the rest (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`/tests/ui/app.html?room=settings&signed-in&set.settings.show-all=true&${query}`);
    await page.waitForFunction(() => 'orbitTest' in window);
    expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
    await page.locator('.settings-nav-item[data-category="accounts"]').click();
    await expect(page.locator('.jellyfin-section .setting-row')).toBeVisible();
    await expect(page.locator('.plex-section .setting-row')).toBeVisible();
    await page.evaluate(() => window.orbitTest.settled(4000));
    // Each row's far edge (its end side: right, or left in Arabic), by section.
    const ends = await page.locator('.settings-pane').evaluate((pane) => {
      const rtl = getComputedStyle(pane).direction === 'rtl';
      return [...pane.querySelectorAll<HTMLElement>('.setting-row')]
        // A row in a form (Live TV's Add a source) is as wide as the form's fields.
        .filter((row) => row.checkVisibility() && !row.closest('.tv-add')?.querySelector('.tv-fields'))
        .map((row) => {
          const box = row.getBoundingClientRect();
          return { row: (row.textContent ?? '').trim().slice(0, 30), end: Math.round(rtl ? box.left : box.right) };
        });
    });
    const usual = ends.map((e) => e.end).sort((a, b) => ends.filter((e) => e.end === b).length - ends.filter((e) => e.end === a).length)[0];
    expect(ends.filter((e) => Math.abs(e.end - usual!) > 1)).toEqual([]);
  });
}

async function accounts(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/tests/ui/app.html?room=settings&set.settings.show-all=true&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="accounts"]').click();
}

test('Sync now after Stremio ended the session offers signing in again, not "in sync"', async ({ page }) => {
  await accounts(page, 'signed-in&fail.stremio_library_pull=error:err.stremio.session-ended');
  const stremio = page.locator('.stremio-section');
  await stremio.getByRole('button', { name: 'Sync now' }).click();
  await expect(stremio.getByRole('button', { name: 'Sign in with Stremio' })).toBeVisible();
  await expect(stremio.locator('.provider-message')).toHaveText('Your Stremio session has ended. Sign in again to keep syncing.');
  await expect(stremio.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await expect(stremio.getByRole('button', { name: 'Sign in with Stremio' })).toBeFocused();
});

test('a browser sign-in given up on for a password one, timing out later, leaves the account signed in', async ({ page }) => {
  await accounts(page, '');
  const stremio = page.locator('.stremio-section');
  await stremio.getByRole('button', { name: 'Sign in with Stremio' }).click();
  await stremio.getByRole('button', { name: 'Use email and password' }).click();
  await stremio.locator('input[type=email]').click();
  await stremio.locator('input[type=email]').fill('sam@example.com');
  await stremio.locator('input[type=password]').click();
  await stremio.locator('input[type=password]').fill('secret');
  await stremio.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(stremio.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // Five minutes on, the browser sign-in nobody finished gives up.
  await page.evaluate(() => window.orbitTest.emit('stremio://signed-in', { profile: 'main', error: 'err.stremio.login-timeout' }));
  await page.evaluate(() => window.orbitTest.settled());
  await expect(stremio.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(stremio.getByRole('button', { name: 'Sign in with Stremio' })).toHaveCount(0);
});

test('connecting and disconnecting Letterboxd by keyboard keeps focus in its row', async ({ page }) => {
  await accounts(page, '');
  const letterboxd = page.locator('.letterboxd-section');
  const field = letterboxd.getByRole('textbox');
  await field.click();
  await field.fill('samwatches');
  await letterboxd.getByRole('button', { name: 'Connect' }).focus();
  await page.keyboard.press('Enter');
  await expect(letterboxd.getByRole('button', { name: 'Disconnect' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(letterboxd.getByRole('textbox')).toBeFocused();
});

test('a debrid key refused by keyboard leaves focus on Connect, to try again', async ({ page }) => {
  await accounts(page, 'fail.debrid_connect=error:Real-Debrid didn’t accept that key.');
  const debrid = page.locator('.debrid-section');
  const field = debrid.getByRole('textbox', { name: /Real-Debrid/ });
  await field.click();
  await field.fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const connect = debrid.getByRole('button', { name: 'Connect' }).first();
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(debrid.locator('.provider-message').first()).not.toBeEmpty();
  await page.evaluate(() => window.orbitTest.settled());
  await expect(connect).toBeFocused();
});

test('importing Stremio addons by keyboard leaves focus on Import addons', async ({ page }) => {
  await accounts(page, 'signed-in');
  const stremio = page.locator('.stremio-section');
  await stremio.getByRole('button', { name: 'Import addons…' }).click();
  const go = stremio.getByRole('button', { name: 'Import selected' });
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveCount(0);
  await expect(stremio.getByRole('button', { name: 'Import addons…' })).toBeFocused();
});

test('signing in while offline says to reconnect and try again, not that it reloads by itself', async ({ page }) => {
  await accounts(page, 'offline&fail.stremio_login=error:err.stremio.unreachable');
  const stremio = page.locator('.stremio-section');
  await stremio.getByRole('button', { name: 'Use email and password' }).click();
  for (const [field, text] of [['email', 'sam@example.com'], ['password', 'hunter2']] as const) {
    await stremio.locator(`input[type=${field}]`).click();
    await stremio.locator(`input[type=${field}]`).fill(text);
  }
  await stremio.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(stremio.locator('.provider-message')).toHaveText('You’re offline. Reconnect, then try again.');
});

test('a debrid key the service stopped accepting says what to do in the row itself', async ({ page }) => {
  await accounts(page, 'signed-in&debrid-problem=denied');
  await expect(page.locator('.debrid-section .provider-message').first()).toHaveText('Real-Debrid no longer accepts this key. Remove it, then add a new one from your Real-Debrid account.');
});

test("an AI translation key the keychain couldn't keep isn't called a bad key", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/tests/ui/app.html?room=settings&set.settings.show-all=true&set.subtitles.ai-translate=true&set.subtitles.ai={"provider":"openai"}&fail.subtrans_set_key=error:err.keychain.failed&fail.subtrans_key_saved=null');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await page.locator('.settings-nav-item[data-category="subtitles"]').click();
  const key = page.getByRole('textbox', { name: 'API key' });
  await key.click();
  await key.fill('sk-test-0123456789abcdef');
  await key.press('Enter');
  await expect(page.getByText('Orbit couldn’t use the system’s secure storage. Restarting Orbit usually helps.')).toBeVisible();
});

test('an AniList section replaced by a redraw of Accounts stops drawing', async ({ page }) => {
  await accounts(page, 'signed-in');
  await expect(page.locator('.anilist-section .anilist-account')).toBeVisible();
  await page.evaluate(() => {
    const old = document.querySelector('.anilist-section')!;
    Object.assign(window, { oldAniList: { section: old, account: old.querySelector('.anilist-account') } });
  });
  // A Live TV setting Accounts shows, saved while another category is shown: Accounts is drawn again when it's back.
  await page.locator('.settings-nav-item[data-category="general"]').click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('orbit:setting-saved', { detail: 'live.open-on' })));
  await page.locator('.settings-nav-item[data-category="accounts"]').click();
  await expect(page.locator('.anilist-section .anilist-account')).toBeVisible();
  // The new section asks AniList how things stand, which every section still listening redraws for.
  await page.evaluate(() => window.orbitTest.settled());
  const old = await page.evaluate(() => {
    const { section, account } = (window as unknown as { oldAniList: { section: Element; account: Element } }).oldAniList;
    return { replaced: section !== document.querySelector('.anilist-section'), drawnAgain: !section.contains(account) };
  });
  expect(old).toEqual({ replaced: true, drawnAgain: false });
});

test('a guide updated while Accounts is out of sight shows when it comes back', async ({ page }) => {
  await accounts(page, '');
  const row = page.locator('.tv-source').first();
  await expect(row).toContainText('8 channels');
  await page.locator('.settings-nav-item[data-category="general"]').click();
  await page.evaluate(async () => {
    window.orbitTest.data.tvSources[0]!.channels = 12;
    await window.orbitTest.emit('iptv://updated', 'tv1');
    await window.orbitTest.settled();
  });
  await page.locator('.settings-nav-item[data-category="accounts"]').click();
  await expect(row).toContainText('12 channels');
});
