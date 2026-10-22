/**
 * The layout sweep: every page in every Look at a narrow, a middle and a wide window, scrolled top to bottom, and
 * the player in every preset with its controls and the volume slider showing, checked by sweep.ts for controls
 * and text drawn over each other or cut off. A failure attaches a screenshot with each problem outlined in red.
 *
 * `SWEEP_SHOTS=1 pnpm test:ui sweep` also saves every screen it checks to test-results/sweep/, to look through by eye
 * for what no rule catches (a colour that doesn't read, a gap that looks wrong).
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { findLayoutProblems, type Problem } from './sweep';

/** src/theme/looks.ts LOOK_IDS (importing it here would bring the app's CSS into Node). */
const LOOKS = ['orbit', 'crimson', 'marquee', 'premiere', 'glass', 'aurora', 'couch', 'afterglow', 'arc'];
const ROOMS = ['home', 'movies', 'series', 'anime', 'explore', 'live', 'search', 'library', 'downloads', 'addons', 'settings'];
const TITLES = ['The Last Harbor', 'Blackwater County'];
const PRESETS = ['orbit', 'minimal', 'streaming', 'theater', 'cinema', 'compact', 'floating', 'tv', 'arc'];
const WIDTHS = [900, 1280, 1920];
// Node's `process`, without its types (the specs are typed for the page).
const SHOTS = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SWEEP_SHOTS;

const STILL = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }';

/**
 * Known and accepted, each with why: `kind` and a piece of `what`.
 * Keep this short: an entry here hides that problem everywhere.
 */
const ACCEPTED: { kind: Problem['kind']; what: string; why: string }[] = [
  { kind: 'overlap', what: 'span.player-tip-label', why: "a control's tooltip is meant to float over what's beside it" },
  { kind: 'overlap', what: 'kbd "', why: "a tooltip's key cap, as above" },
  { kind: 'overlap', what: 'span.rail-heading-top "Top 10" × span.rail-heading-rest', why: 'the two lines of a Top 10 heading are set tight: their line boxes meet, the letters don\'t' },
  { kind: 'overlap', what: 'h1.explore-title "Discover" × p.muted', why: "Marquee's Bebas Neue title is set at line-height 1: the font's box reaches 8px under it into the line below, its capitals (it has no lower case) don't" },
];

const accepted = (p: Problem) => ACCEPTED.some((a) => a.kind === p.kind && p.what.includes(a.what));

const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** Checks the screen as it is now; saves it (outlined where wrong) and returns the problems, labelled with `where`. */
async function check(page: Page, info: TestInfo, where: string): Promise<string[]> {
  const problems = (await page.evaluate(findLayoutProblems)).filter((p) => !accepted(p));
  const file = where.replace(/[^\w-]+/g, '-');
  if (problems.length) {
    await outline(page, problems);
    await info.attach(`${file}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => document.querySelectorAll('.sweep-outline').forEach((el) => el.remove()));
  }
  if (SHOTS) await page.screenshot({ path: `test-results/sweep/${file}.png` });
  return problems.map((p) => `${where}: ${p.kind}: ${p.what}`);
}

function outline(page: Page, problems: Problem[]): Promise<void> {
  return page.evaluate((boxes) => {
    for (const b of boxes) {
      const el = document.createElement('div');
      el.className = 'sweep-outline';
      el.style.cssText = `position:fixed;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;outline:2px solid red;outline-offset:-1px;z-index:2147483647;pointer-events:none`;
      document.body.append(el);
    }
  }, problems.flatMap((p) => p.boxes));
}

/** Checks the page at each width, scrolled through `.outlet` one window at a time (up to `pages` windows). */
async function sweepWidths(page: Page, info: TestInfo, label: string, pages = 4): Promise<string[]> {
  const found: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.orbitTest.settled());
    await frames(page);
    const outlet = page.locator('.outlet').filter({ visible: true }).first();
    const height = (await outlet.count()) ? await outlet.evaluate((el) => el.clientHeight) : 0;
    for (let n = 0; n < pages; n++) {
      if (n > 0) {
        const moved = await outlet.evaluate((el, step) => {
          const before = el.scrollTop;
          el.scrollTop = before + step;
          return el.scrollTop !== before;
        }, Math.max(200, height - 120));
        if (!moved) break;
        await page.evaluate(() => window.orbitTest.settled(3000));
      }
      found.push(...(await check(page, info, `${label} ${width}px${n ? ` scrolled ${n}` : ''}`)));
    }
    if (height) await outlet.evaluate((el) => (el.scrollTop = 0));
  }
  return found;
}

async function openApp(page: Page, query: string): Promise<void> {
  await page.goto(`/tests/ui/app.html?${query}`);
  await page.waitForFunction(() => 'orbitTest' in window);
  expect(await page.evaluate(() => window.orbitTest.ready), 'the page settles').toBe(true);
  await page.addStyleTag({ content: STILL });
}

for (const look of LOOKS) {
  for (const room of ROOMS) {
    test(`${look} ${room}: nothing drawn over or cut off`, async ({ page }, info) => {
      await openApp(page, `look=${look}&room=${room}`);
      expect(await sweepWidths(page, info, `${look} ${room}`)).toEqual([]);
    });
  }
  for (const title of TITLES) {
    test(`${look} "${title}": nothing drawn over or cut off`, async ({ page }, info) => {
      await openApp(page, `look=${look}&room=home&title=${encodeURIComponent(title)}`);
      expect(await sweepWidths(page, info, `${look} ${title}`)).toEqual([]);
    });
  }
}

// A Look switched while the app runs (Settings → Looks, Quick settings), not loaded fresh: what one Look leaves
// behind can break the next. Each Look is switched to from the one before it in the list, and Home checked.
for (const [i, look] of LOOKS.entries()) {
  const from = LOOKS[(i + LOOKS.length - 1) % LOOKS.length]!;
  test(`switch ${from} → ${look}: Home has nothing drawn over or cut off`, async ({ page }, info) => {
    await openApp(page, `look=${from}&room=home`);
    // As a person does it: Quick settings, the Look's swatch, then close the panel.
    await page.locator('.settings-button').click();
    await page.locator(`.quick-look[data-look="${look}"]`).click();
    await expect(page.locator(`.quick-look[data-look="${look}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.quick-panel')).toBeHidden();
    await page.evaluate(() => window.orbitTest.settled());
    expect(await sweepWidths(page, info, `switch ${from} to ${look} home`)).toEqual([]);
  });
}

// Long names (German) and right to left (Arabic), in the default Look.
for (const lang of ['de', 'ar']) {
  for (const room of [...ROOMS, 'title']) {
    test(`${lang} ${room}: nothing drawn over or cut off`, async ({ page }, info) => {
      await openApp(page, room === 'title' ? `lang=${lang}&room=home&title=${encodeURIComponent(TITLES[1]!)}` : `lang=${lang}&room=${room}`);
      expect(await sweepWidths(page, info, `${lang} ${room}`)).toEqual([]);
    });
  }
}

/** A show's subtitle tracks, so the bar has its Subtitles chip too (with Next episode and Episodes, its fullest). */
const TRACKS = [
  { id: 1, kind: 'audio', title: null, lang: 'eng', codec: 'eac3', channels: 6, selected: true, secondary: false, external: false, default: true, forced: false },
  { id: 1, kind: 'sub', title: 'English', lang: 'eng', codec: 'subrip', channels: null, selected: true, secondary: false, external: false, default: true, forced: false },
  { id: 2, kind: 'sub', title: null, lang: 'fra', codec: 'ass', channels: null, selected: false, secondary: false, external: false, default: false, forced: false },
];

for (const preset of PRESETS) {
  for (const size of ['standard', 'large']) {
    test(`player ${preset} (${size}): controls and the volume slider clear of each other`, async ({ page }, info) => {
      await openApp(page, `set.player.layout=${encodeURIComponent(JSON.stringify({ preset, background: 'blur', ...(size === 'large' ? { size } : {}) }))}`);
      await page.evaluate(() => window.orbitTest.openPlayer('Blackwater County'));
      await expect(page.locator('.player.started')).toBeVisible();
      await page.evaluate(async (tracks) => {
        const open = window.orbitTest.calls.filter(([cmd]) => cmd === 'player_open').at(-1);
        await window.orbitTest.emit('player://event', { load: (open?.[1] as { load: number }).load, kind: 'tracks', tracks });
      }, TRACKS);
      const found: string[] = [];
      for (const width of [900, 1100, 1300, 1600, 1920]) {
        await page.setViewportSize({ width, height: Math.round((width * 9) / 16) });
        await frames(page);
        // Controls showing: the pointer over the bottom bar.
        const bar = (await page.locator('.player-bottom').boundingBox())!;
        await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height - 10);
        await frames(page);
        found.push(...(await check(page, info, `player ${preset} ${size} ${width}px`)));
        // The volume slider open: the pointer on the volume button.
        const volume = page.locator('.player-volume:visible').first();
        const knob = (await volume.count()) ? await volume.boundingBox() : null;
        if (knob) {
          // The pointer, not hover(): hover() waits for the button to be uncovered, which is what's being checked.
          await page.mouse.move(knob.x + 12, knob.y + knob.height / 2);
          await frames(page);
          found.push(...(await check(page, info, `player ${preset} ${size} ${width}px volume`)));
        }
      }
      expect(found).toEqual([]);
    });
  }
}
