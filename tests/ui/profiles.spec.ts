/**
 * Manage profiles laid out in Chromium (app-fixture.ts): the editor's name field keeps its
 * height, its sections line up, their choices fit their pills in long languages, and a
 * focused tile shows one focus ring (the avatar's), not two.
 */
import { expect, test, type Page } from '@playwright/test';

async function manageProfiles(page: Page, query = ''): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/tests/ui/app.html?room=settings&${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  // As Settings → General → Profiles → Manage profiles opens it.
  await page.evaluate(async () => {
    const { openProfileSwitcher } = (await import('/src/rooms/profiles/picker.ts' as string)) as typeof import('../../src/rooms/profiles/picker');
    void openProfileSwitcher(true);
  });
  await expect(page.locator('.who.overlay .who-tile').first()).toBeVisible();
}

test('the name field is as tall as its line of text, adding a profile and editing one', async ({ page }) => {
  await manageProfiles(page);
  const squashed = () =>
    page.locator('.who-name-field').evaluate((field) => {
      const style = getComputedStyle(field);
      return field.getBoundingClientRect().height < parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    });
  await page.locator('.who-tile-add').click();
  expect(await squashed()).toBe(false);
  await page.locator('.who-actions .button.glass').click();
  await page.locator('[data-focus-id="main"]').click();
  expect(await squashed()).toBe(false);
});

test("the editor's sections are one width, so their dividers line up", async ({ page }) => {
  await manageProfiles(page);
  for (const id of ['main', 'kids']) {
    await page.locator(`[data-focus-id="${id}"]`).click();
    const widths = await page.locator('.who-section').evaluateAll((sections) => sections.map((s) => Math.round(s.getBoundingClientRect().width)));
    expect(new Set(widths).size, `${id}: ${widths.join(', ')}`).toBe(1);
    await page.locator('.who-actions .button.glass').click();
  }
});

for (const lang of ['de', 'ar']) {
  test(`content limit and addon choices fit their pills (${lang})`, async ({ page }) => {
    await manageProfiles(page, `lang=${lang}`);
    await page.locator('[data-focus-id="kids"]').click();
    const spilling = await page.locator('.who-section .segment').evaluateAll((segments) =>
      segments.filter((s) => {
        const box = s.getBoundingClientRect();
        const pill = s.parentElement!.getBoundingClientRect();
        return s.scrollHeight > s.clientHeight + 1 || box.top < pill.top || box.bottom > pill.bottom;
      }).map((s) => s.textContent),
    );
    expect(spilling).toEqual([]);
  });
}

test('a focused profile tile shows only its avatar ring', async ({ page }) => {
  await manageProfiles(page);
  await page.keyboard.press('ArrowRight');
  const tile = page.locator('.who-tile:focus-visible');
  await expect(tile).toHaveCount(1);
  expect(await tile.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  expect(await tile.locator('.avatar').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
});

// The character browser's TMDB pictures (title posters, character photos) that don't load leave their frames bare,
// not the browser's broken-image icon.
test("the character browser shows no broken-image icons when TMDB's pictures don't load", async ({ page }) => {
  await manageProfiles(page, 'no-art');
  await page.locator('[data-focus-id="main"]').click();
  await page.locator('.picture-preview').click();
  await page.getByRole('button', { name: 'Browse show characters' }).click();
  await expect(page.locator('.character-option').first()).toBeVisible();
  const broken = () => page.locator('.who img').evaluateAll((all) => all.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 0).length);
  await expect.poll(broken).toBe(0);
  // Activated first: focus alone doesn't start editing a field.
  await page.locator('input.character-search, .character-search input').first().click();
  await page.keyboard.type('the');
  await page.keyboard.press('Enter');
  await expect(page.locator('.character-title').first()).toBeVisible();
  await expect.poll(broken).toBe(0);
});

test('a content-limit switch keeps focus after it saves', async ({ page }) => {
  await manageProfiles(page);
  await page.locator('[data-focus-id="kids"]').click();
  await page.locator('[data-limit="unrated"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-limit="unrated"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-limit="unrated"]')).toBeFocused();
});

test('a profile deleted with some of its data left behind leaves the grid', async ({ page }) => {
  await manageProfiles(page);
  // Rust deletes the profile, then a keychain step fails (profiles.rs `all_done`).
  await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    internals.invoke = async (cmd, args, options) => {
      const answer = await invoke(cmd, args, options);
      if (cmd === 'profile_delete') throw 'err.profile.cleanup';
      return answer;
    };
  });
  await page.locator('[data-focus-id="kids"]').click();
  const remove = page.locator('.who-section .button.danger');
  await remove.click();
  await remove.click();
  await expect(page.locator('[data-focus-id="kids"]')).toHaveCount(0);
  await expect(page.locator('[data-focus-id="main"]')).toBeVisible();
});

test("another profile's PIN-locked editor can't be renamed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tests/ui/app.html?room=settings');
  await page.waitForFunction(() => 'orbitTest' in window);
  // Kids has a PIN, and Sam (the profile in use) can't change it without switching (profiles.rs `can_manage`).
  await page.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    internals.invoke = async (cmd, args, options) => {
      const answer = await invoke(cmd, args, options);
      return cmd === 'profile_list' ? (answer as { id: string }[]).map((p) => (p.id === 'kids' ? { ...p, hasPin: true } : p)) : answer;
    };
    const { openProfileSwitcher } = (await import('/src/rooms/profiles/picker.ts' as string)) as typeof import('../../src/rooms/profiles/picker');
    void openProfileSwitcher(true);
  });
  await page.locator('[data-focus-id="kids"]').click();
  await expect(page.locator('.who-name-field')).toBeDisabled();
});

test('choosing a profile that fails to open says so', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tests/ui/app.html?room=settings');
  await page.waitForFunction(() => 'orbitTest' in window);
  await page.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    // The keychain can't be read, so Rust can't tell whether the profile has a PIN.
    internals.invoke = async (cmd, args, options) => (cmd === 'profile_select' ? Promise.reject('err.keychain.locked') : invoke(cmd, args, options));
    const { openProfileSwitcher } = (await import('/src/rooms/profiles/picker.ts' as string)) as typeof import('../../src/rooms/profiles/picker');
    void openProfileSwitcher();
  });
  await page.locator('[data-focus-id="kids"]').click();
  await expect(page.locator('.who-grid-message')).not.toBeEmpty();
  await expect(page.locator('[data-focus-id="kids"]')).toBeVisible();
});

test('a new PIN is typed twice, and saved only when both match', async ({ page }) => {
  await manageProfiles(page);
  await page.locator('[data-focus-id="main"]').click();
  await page.locator('.who-section .button', { hasText: 'Set a PIN' }).click();
  const field = page.locator('.pin-input');
  await field.pressSequentially('1234');
  await expect(page.locator('.who-section .muted', { hasText: 'Type the same PIN again' })).toBeVisible();
  await page.locator('.pin-input').pressSequentially('1243');
  // A typo: back to the first step, nothing saved.
  await expect(page.locator('.pin-message', { hasText: 'don’t match' })).toBeVisible();
  await expect(page.locator('.who-section .muted', { hasText: 'Type a new 4-digit PIN' })).toBeVisible();
  await page.locator('.pin-input').pressSequentially('1234');
  await page.locator('.pin-input').pressSequentially('1234');
  // Saved: back on the grid, Sam's tile has the lock.
  await expect(page.locator('[data-focus-id="main"] .who-badge-lock')).toBeVisible();
});
