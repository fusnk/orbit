/**
 * First-run setup and Home's Getting started card on a new install (app-fixture.ts `fresh`).
 */
import { expect, test, type Page } from '@playwright/test';

async function openSetup(page: Page, query = ''): Promise<void> {
  await page.goto(`/tests/ui/app.html?fresh${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  await expect(page.locator('.onboard')).toBeVisible();
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-autofocus], .settings-button')?.className ?? document.activeElement?.tagName);

for (const end of ['Skip setup', 'Finish']) {
  // As at any other launch, the first arrow press after setup starts on Home's banner, not beside where setup's last button was.
  test(`after ${end}, the first arrow press starts on Home`, async ({ page }) => {
    await openSetup(page);
    if (end === 'Finish') for (let i = 0; i < 3; i++) await page.locator('.onboard-foot .primary').press('Enter');
    await page.getByRole('button', { name: end }).press('Enter');
    await expect(page.locator('.onboard')).toHaveCount(0);
    await page.evaluate(() => window.orbitTest.settled());
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('button large primary');
    await expect(page.locator('.hero [data-autofocus]')).toBeFocused();
  });
}

for (const query of ['', '&lang=ar']) {
  // In a narrow window the items wrap under the title; dismiss stays at the card's end, not beside the title.
  test(`Getting started's dismiss sits at the card's end in a narrow window${query ? ', right to left' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openSetup(page, query);
    await page.locator('.onboard-skip').click();
    const card = page.locator('.checklist');
    await expect(card).toBeVisible();
    const { gap, wrapped } = await card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const close = el.querySelector('.welcome-dismiss')!.getBoundingClientRect();
      const end = getComputedStyle(el).direction === 'rtl' ? close.left - box.left : box.right - close.right;
      return { gap: end, wrapped: el.querySelector('.checklist-items')!.getBoundingClientRect().top > close.bottom };
    });
    expect(wrapped, 'the items wrap under the title at 900px').toBe(true);
    expect(gap).toBeLessThan(24);
  });
}

for (const query of ['', '&lang=ar']) {
  // "Pick a Look" starts at its heading; Down goes on to the first Look (the one in use on a new install), not the second.
  test(`Down from "Pick a Look" reaches the first Look${query ? ', right to left' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSetup(page, query);
    await page.locator('.onboard-foot .primary').press('Enter');
    await expect(page.locator('.onboard-title')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.onboard-body .look-card').first()).toBeFocused();
    await expect(page.locator('.onboard-body .look-card').first()).toHaveAttribute('aria-pressed', 'true');
  });
}

// "Bring your stuff" says to add an addon: one of its choices does, with the Addons page's own field and review,
// and says where install links come from (a newcomer without a Stremio account had nowhere to go).
test('setup can add a first addon from its link', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSetup(page);
  for (let i = 0; i < 2; i++) await page.locator('.onboard-foot .primary').press('Enter');
  await expect(page.locator('.onboard-title')).toHaveText('Bring your stuff');
  await page.getByRole('button', { name: /Paste an addon link/ }).click();
  await expect(page.locator('.onboard-body')).toContainText('Addons are made by the community, not by Orbit.');
  const field = page.locator('.onboard-body input');
  await field.click();
  await field.fill('stremio://cool-films.example.com/manifest.json');
  await page.locator('.onboard-body .install-row button').click();
  await page.evaluate(() => window.orbitTest.settled());
  await page.locator('.onboard-body').getByRole('button', { name: 'Install', exact: true }).click();
  await page.evaluate(() => window.orbitTest.settled());
  await expect(page.locator('.onboard-body .status').last()).toContainText('Cool Films');
  // Setup is still open on the same step: the person goes on from here.
  await expect(page.locator('.onboard-title')).toHaveText('Bring your stuff');
});

// Inside setup, Stremio is named once (by its row, under the step that's about it), and debrid is introduced once.
test('setup names Stremio and introduces debrid once each', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSetup(page);
  for (let i = 0; i < 2; i++) await page.locator('.onboard-foot .primary').press('Enter');
  await page.getByRole('button', { name: /Sign in to Stremio/ }).click();
  await expect(page.locator('.onboard-body .stremio-section')).toContainText('Stremio account');
  await expect(page.locator('.onboard-body .stremio-section .settings-subheading')).toHaveCount(0);
  await page.locator('.onboard-foot .primary').press('Enter');
  await expect(page.locator('.onboard-title')).toHaveText('Optional extras');
  const debrid = page.locator('.onboard-body .onboard-debrid');
  await expect(debrid.locator('p:not(.provider-message)')).toHaveCount(1);
  await expect(debrid).toContainText('Have a Real-Debrid or TorBox account?');
  await expect(debrid).not.toContainText('See and play what’s already in your own debrid accounts');
});

// Orbit comes with no stream addon: until one is added, "Play something" leads to adding one, not to Movies and "No stream addons installed".
test('Getting started’s "Play something" leads to adding an addon until one finds streams', async ({ page }) => {
  await openSetup(page);
  await page.locator('.onboard-skip').click();
  await page.locator('.checklist').getByRole('button', { name: 'Play something' }).click();
  await page.evaluate(() => window.orbitTest.settled());
  await expect(page.locator('.settings-nav-item[data-category="addons"]')).toHaveAttribute('aria-current', /page|true/);
});

// A new install is welcomed rather than told the time of day, until the Getting started card is closed (or something is watched).
test('Home welcomes a new install until Getting started is closed', async ({ page }) => {
  await openSetup(page);
  await page.locator('.onboard-skip').click();
  const greeting = page.locator('.home-greeting');
  await expect(greeting).toHaveText('Welcome to Orbit 👋');
  await page.locator('.checklist .welcome-dismiss').click();
  await expect(greeting).toHaveText(/^(Good morning|Good afternoon|Good evening|Still up\?)$/);
});

test('Home greets an existing install by the time of day', async ({ page }) => {
  await page.goto('/tests/ui/app.html?room=home');
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready)).toBe(true);
  await expect(page.locator('.home-greeting')).toHaveText(/^(Good morning|Good afternoon|Good evening|Still up), Sam\??$/);
});
