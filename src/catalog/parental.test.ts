import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentLimit } from './ratings';
import type { Title } from './titles';

let profileLimit: ContentLimit;
let tmdb = true;
/** Makes the ratings lookup fail, as offline or rate limited. */
let lookupFails = false;
/** Makes reading the TMDB token fail (a locked keychain): Rust can't say whether one is saved. */
let tokenUnreadable = false;
/** Certifications TMDB "has", by IMDb id; ids missing here aren't known to TMDB (Rust answers them with no certifications). */
const ratings: Record<string, { certs: Record<string, string>; adult?: boolean }> = {
  tt1: { certs: { US: 'G' } },
  tt2: { certs: { US: 'PG-13', GB: '12A' } },
  tt3: { certs: { US: 'R' } },
  tt4: { certs: { US: 'NC-17' } },
  tt5: { certs: { US: 'G' }, adult: true },
  tt6: { certs: {} },
};
/** Ids whose own lookup fails (one title timing out, say): Rust leaves them out of its answer. */
const dropped = new Set<string>();
/** While set, lookups wait for it: TMDB being slow. */
let hold: Promise<void> | undefined;
const asked: string[][] = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: { titles?: { id: string }[] }) => {
    if (cmd === 'profile_list') return [{ id: 'kid', name: 'Kid', color: '#46c28e', avatar: null, addonsFrom: null, hasPin: false, contentLimit: profileLimit }];
    if (cmd === 'profile_active') return 'kid';
    if (cmd === 'tmdb_token_saved') {
      if (tokenUnreadable) throw 'The keychain is locked';
      return tmdb;
    }
    if (cmd === 'tmdb_certifications') {
      if (lookupFails) throw new Error('offline');
      asked.push(args.titles!.map((t) => t.id));
      await hold;
      return args.titles!.flatMap(({ id }) => (dropped.has(id) ? [] : [{ id, certs: ratings[id]?.certs ?? {}, adult: ratings[id]?.adult ?? false }]));
    }
    throw new Error(`unexpected ${cmd}`);
  },
}));
vi.mock('../lib/ipc', () => ({ settings: { get: async (key: string) => (key === 'streaming.region' ? 'GB' : null), set: async () => {} } }));

const title = (id: string, type = 'movie'): Title => ({ id, type, name: id, genres: [], origins: [] });
const all = ['tt1', 'tt2', 'tt3', 'tt4', 'tt5', 'tt6', 'tt7'].map((id) => title(id));
const ids = (titles: Title[]) => titles.map((t) => t.id);

async function load(limit: ContentLimit) {
  profileLimit = limit;
  vi.resetModules();
  const parental = await import('./parental');
  await parental.loadContentLimit();
  return parental;
}

describe('content limits', () => {
  // The first import transforms the whole module graph (i18n and its locales included), which
  // takes seconds on a loaded machine; do it once here so no test's own timeout pays for it.
  beforeAll(() => import('./parental'));
  beforeEach(() => {
    tmdb = true;
    lookupFails = false;
    tokenUnreadable = false;
    dropped.clear();
    asked.length = 0;
    hold = undefined;
  });

  it('keeps titles blocked while their ratings can’t be looked up, even where unrated ones are allowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    lookupFails = true;
    // Offline: nothing is known, so the R-rated tt3 must not slip through as "unrated" (nor must the rest).
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual([]);
    // Back online and past the retry wait, they are rated for real.
    lookupFails = false;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual(['tt1']);
    now.mockRestore();
    warn.mockRestore();
  });

  it('tells a title blocked because its rating couldn’t be looked up from one blocked for its rating', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'kids', allowUnrated: false, allowLiveTv: false });
    expect(await p.verdictFor(title('tt3'))).toBe('blocked');
    expect(p.ratingUnreachable(title('tt3'))).toBe(false);
    lookupFails = true;
    expect(await p.verdictFor(title('tt1'))).toBe('blocked');
    expect(p.ratingUnreachable(title('tt1'))).toBe(true);
    warn.mockRestore();
  });

  it('keeps titles blocked while the keychain can’t say whether a TMDB token is saved, even where unrated ones are allowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A locked keychain: Rust can't read the token for the lookups either.
    tokenUnreadable = true;
    lookupFails = true;
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    // Not "no token, so everything is unrated": the R-rated tt3 must not slip through.
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual([]);
    // Unlocked, and past the retry wait, they are rated for real.
    lookupFails = false;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual(['tt1']);
    now.mockRestore();
    warn.mockRestore();
  });

  it('keeps a title blocked when its own lookup failed, even where unrated ones are allowed', async () => {
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    // The batch answers, but without the R-rated tt3 (its lookup timed out): not "unrated".
    dropped.add('tt3');
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual(['tt1']);
    expect(p.verdictNow(title('tt3'))).toBe('blocked');
    // Asked again once the retry wait is over, it's rated for real.
    dropped.clear();
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')]))).toEqual(['tt1']);
    expect(asked.at(-1)).toEqual(['tt3']);
    now.mockRestore();
  });

  it('counts a rating still on its way after the wait as blocked, then decides once it lands', async () => {
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    // TMDB is slow: the R-rated tt3 must not open or play as "unrated", nor show in a list.
    expect(await p.verdictFor(title('tt3'), 10)).toBe('blocked');
    expect(await p.verdictFor(title('tt1'), 10)).toBe('blocked');
    expect(ids(await p.allowedTitles([title('tt1'), title('tt3')], 10))).toEqual([]);
    expect(p.verdictNow(title('tt1'))).toBe('pending');
    // Once the ratings land, each is decided for real.
    const later = Promise.all([p.verdictOnceRated(title('tt1')), p.verdictOnceRated(title('tt3'))]);
    release();
    expect(await later).toEqual(['allowed', 'blocked']);
    expect(p.verdictNow(title('tt1'))).toBe('allowed');
  });

  it('asks about a single title ahead of the rows already waiting', async () => {
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    // Two full batches of row titles, with tt3 at the very end; the first batch is being asked about.
    const rows = Array.from({ length: 85 }, (_, i) => title(`tt${100 + i}`));
    void p.allowedTitles([...rows, title('tt3')], 60_000);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    // A title page for tt3 (already queued) and Play on tt2 (not yet asked about) go next.
    const opened = Promise.all([p.verdictFor(title('tt3')), p.verdictFor(title('tt2'))]);
    release();
    expect(await opened).toEqual(['blocked', 'allowed']);
    expect(asked[1]).toEqual(expect.arrayContaining(['tt3', 'tt2']));
  });

  it('shows everything without a limit, without looking anything up', async () => {
    const { allowedTitles } = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    expect(ids(await allowedTitles(all))).toEqual(ids(all));
    expect(asked).toEqual([]);
  });

  it('keeps only what each level allows, unrated titles by its choice', async () => {
    // tt6 has no certification and tt7 isn't known to TMDB: both are unrated.
    let p = await load({ level: 'kids', allowUnrated: false, allowLiveTv: false });
    expect(ids(await p.allowedTitles(all))).toEqual(['tt1']);
    p = await load({ level: 'kids', allowUnrated: true, allowLiveTv: false });
    expect(ids(await p.allowedTitles(all))).toEqual(['tt1', 'tt6', 'tt7']);
    // The person's region (GB) is read first: 12A is a teen rating.
    p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    expect(ids(await p.allowedTitles(all))).toEqual(['tt1', 'tt2', 'tt6', 'tt7']);
    // TMDB's adult flag outranks the G it also lists.
    p = await load({ level: 'no-adult', allowUnrated: false, allowLiveTv: true });
    expect(ids(await p.allowedTitles(all))).toEqual(['tt1', 'tt2', 'tt3']);
    expect(p.isAdult(title('tt5'))).toBe(true);
    expect(p.certificationOf(title('tt3'))).toBe('R');
  });

  it('asks once per title, in batches', async () => {
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    await Promise.all([p.allowedTitles(all), p.allowedTitles(all)]);
    await p.allowedTitles(all);
    expect(asked).toEqual([ids(all)]);
  });

  it('applies a second profile’s limit too (the avatar picker choosing for that profile)', async () => {
    const kids: ContentLimit = { level: 'kids', allowUnrated: false, allowLiveTv: false };
    // The active profile has no limit: the other one's still applies.
    let p = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    expect(ids(await p.allowedTitles(all, undefined, kids))).toEqual(['tt1']);
    // Both apply: unrated titles pass the active (teens) limit but not the kids one.
    p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    expect(ids(await p.allowedTitles(all, undefined, kids))).toEqual(['tt1']);
    expect(ids(await p.allowedTitles(all, undefined, { ...kids, level: 'no-adult', allowUnrated: true }))).toEqual(['tt1', 'tt2', 'tt6', 'tt7']);
  });

  it('treats every title as unrated without TMDB, and non-IMDb ids always', async () => {
    tmdb = false;
    let p = await load({ level: 'kids', allowUnrated: false, allowLiveTv: false });
    expect(await p.allowedTitles(all)).toEqual([]);
    expect(asked).toEqual([]);
    tmdb = true;
    p = await load({ level: 'teens', allowUnrated: false, allowLiveTv: true });
    expect(ids(await p.allowedTitles([title('kitsu:1', 'series'), title('tt1', 'channel'), title('tt1')]))).toEqual(['tt1']);
  });

  it('hides unrated titles without TMDB even where they are allowed, or Teens would filter nothing', async () => {
    tmdb = false;
    for (const level of ['teens', 'no-adult'] as const) {
      const p = await load({ level, allowUnrated: true, allowLiveTv: true });
      expect(await p.allowedTitles(all)).toEqual([]);
      expect(await p.verdictFor(title('tt4'))).toBe('blocked');
      expect(p.playVerdict({ title: title('tt4') })).toBe('blocked');
    }
    // A rating the person's own server gives still counts.
    const p = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    p.noteServerRating('plex:s2:d', 'PG');
    expect(p.verdictNow(title('plex:s2:d'))).toBe('allowed');
    // With a token saved, the switch is the person's again.
    tmdb = true;
    const rated = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    expect(ids(await rated.allowedTitles([title('kitsu:1', 'series'), title('tt3')]))).toEqual(['kitsu:1']);
  });

  it('keeps cards hidden until their title is known to be allowed', async () => {
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    const card = (id: string) => p.guardCard({ hidden: false, dataset: {} } as unknown as HTMLElement, title(id));
    const cards = ['tt1', 'tt3', 'tt7'].map(card);
    expect(cards.map((c) => c.hidden)).toEqual([true, true, true]);
    const kept = await p.settleCards(cards);
    expect(kept).toEqual([cards[0]]);
    expect(cards.map((c) => c.hidden)).toEqual([false, true, true]);
    // Known titles are decided at once.
    expect(card('tt1').hidden).toBe(false);
  });

  it('looks again at cards a failed lookup hid, once the retry wait is over', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      lookupFails = true;
      const card = p.guardCard({ hidden: false, dataset: {}, isConnected: true, closest: () => null } as unknown as HTMLElement, title('tt1'));
      await vi.advanceTimersByTimeAsync(0);
      // Offline: blocked, not "unrated", and not left waiting either.
      expect(card.hidden).toBe(true);
      expect(card.dataset.parental).toBe('blocked');
      lookupFails = false;
      await vi.advanceTimersByTimeAsync(30_000);
      // The retry's lookup is batched on the next tick.
      await vi.advanceTimersByTimeAsync(1);
      // The retry asked again and the (G-rated) card is shown without the page being redrawn.
      expect(card.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('looks again at cards on a kept page that was off screen when the retry came, once it’s back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      lookupFails = true;
      const el = { hidden: false, dataset: {}, isConnected: true, closest: () => null };
      const card = p.guardCard(el as unknown as HTMLElement, title('tt1'));
      await vi.advanceTimersByTimeAsync(0);
      expect(card.hidden).toBe(true);
      // The person moved to another page (the router keeps this one, off the document) and the retry passes it by.
      el.isConnected = false;
      await vi.advanceTimersByTimeAsync(30_001);
      // Back on the page while still offline: it stays hidden (failing closed).
      el.isConnected = true;
      await vi.advanceTimersByTimeAsync(30_001);
      expect(card.hidden).toBe(true);
      // The connection returns: the next look shows the (G-rated) card, without the page being redrawn.
      lookupFails = false;
      await vi.advanceTimersByTimeAsync(30_001);
      await vi.advanceTimersByTimeAsync(1);
      expect(card.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('looks up age-rating badges without a limit, once, in batches', async () => {
    const p = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    // The person's region (GB) first, then the US; unrated, unknown and non-IMDb titles get no badge.
    const found = await Promise.all(['tt2', 'tt3', 'tt6', 'tt7'].map((id) => p.certificationFor(title(id))));
    expect(found).toEqual(['12A', 'R', null, null]);
    expect(await p.certificationFor(title('kitsu:1', 'series'))).toBeNull();
    expect(await p.certificationFor(title('tt3'))).toBe('R');
    expect(asked).toEqual([['tt2', 'tt3', 'tt6', 'tt7']]);
    // Looking a badge up doesn't turn the (absent) limit on.
    expect(p.verdictNow(title('tt4'))).toBe('allowed');
  });

  it('shows no age-rating badges without TMDB', async () => {
    tmdb = false;
    const p = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    expect(await p.certificationFor(title('tt3'))).toBeNull();
    expect(asked).toEqual([]);
  });

  it('decides what the player may open: links and files as unrated, trailers as their title, Live TV by its switch', async () => {
    const kids = await load({ level: 'kids', allowUnrated: false, allowLiveTv: false });
    const link = { title: title('link:0b1e'), link: true };
    const file = { title: title('local:abc'), local: true };
    // A pasted link or a dropped file has no rating: unrated, so hidden where unrated titles are.
    expect(kids.playVerdict(link)).toBe('blocked');
    expect(kids.playVerdict(file)).toBe('blocked');
    // Live TV and catch-up follow the Live TV switch, not "unrated".
    expect(kids.playVerdict({ title: title('tv:s:c'), live: true })).toBe('blocked');
    expect(kids.playVerdict({ title: title('tv:s:c:1'), replay: true })).toBe('blocked');
    // A trailer is its title's: the R-rated tt3's trailer is blocked, the G-rated tt1's isn't (once rated).
    await kids.allowedTitles([title('tt1'), title('tt3')]);
    expect(kids.playVerdict({ title: title('trailer:tt3'), trailer: true })).toBe('blocked');
    expect(kids.playVerdict({ title: title('trailer:tt1'), trailer: true })).toBe('allowed');
    // A download is its title's too.
    expect(kids.playVerdict({ title: title('tt3') })).toBe('blocked');

    const teens = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    expect(teens.playVerdict(link)).toBe('allowed');
    expect(teens.playVerdict({ title: title('tv:s:c'), live: true })).toBe('allowed');
    const open = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    expect(open.playVerdict(file)).toBe('allowed');
  });

  it('treats anything the player opens before the limit is read as not yet known, then checks it', async () => {
    profileLimit = { level: 'kids', allowUnrated: false, allowLiveTv: false };
    vi.resetModules();
    const p = await import('./parental');
    // Not "no limit": the R-rated tt3 and a channel wait for the profile's limit…
    expect(p.playVerdict({ title: title('tt3') })).toBe('pending');
    expect(p.playVerdict({ title: title('tv:s:c'), live: true })).toBe('pending');
    expect(p.verdictNow(title('tt3'))).toBe('pending');
    // …and the check the player waits on reads it first, then blocks them.
    expect(await p.verdictFor(title('tt3'))).toBe('blocked');
    expect(p.playVerdict({ title: title('tv:s:c'), live: true })).toBe('blocked');
  });

  it('rates a Jellyfin or Plex title TMDB can’t by its server’s own rating', async () => {
    const teens = await load({ level: 'teens', allowUnrated: true, allowLiveTv: true });
    teens.noteServerRating('jellyfin:s1:a', 'TV-MA');
    teens.noteServerRating('plex:s2:b', 'de/12');
    // Over the limit by the server's word: blocked even though unrated titles are shown; the blocked page says why.
    expect(teens.verdictNow(title('jellyfin:s1:a'))).toBe('blocked');
    expect(teens.certificationOf(title('jellyfin:s1:a'))).toBe('TV-MA');
    expect(teens.verdictNow(title('plex:s2:b'))).toBe('allowed');
    // Without a rating it's unrated, as before.
    expect(teens.verdictNow(title('jellyfin:s1:c'))).toBe('allowed');
    // Without TMDB too: the server's rating doesn't need it.
    tmdb = false;
    const kids = await load({ level: 'kids', allowUnrated: false, allowLiveTv: false });
    kids.noteServerRating('plex:s2:d', 'G');
    expect(kids.verdictNow(title('plex:s2:d'))).toBe('allowed');
    expect(kids.verdictNow(title('plex:s2:e'))).toBe('blocked');
    // Only server titles: an IMDb id is TMDB's to rate.
    kids.noteServerRating('tt3', 'G');
    expect(kids.verdictNow(title('tt3'))).toBe('blocked');
  });

  it('shows a list only the entries the profile may watch, and draws it again once the rest are rated', async () => {
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    const entries = ['tt1', 'tt3', 'tt7'].map((id) => ({ title: title(id) }));
    let redraws = 0;
    // Nothing rated yet: nothing shown (failing closed), and the lookups start.
    expect(p.shownNow(entries, (e) => e.title, () => redraws++)).toEqual([]);
    await vi.waitFor(() => expect(redraws).toBe(1));
    // Once rated: the G-rated tt1 only (the R-rated tt3 and unrated tt7 stay out), and no further redraw.
    expect(p.shownNow(entries, (e) => e.title, () => redraws++).map((e) => e.title.id)).toEqual(['tt1']);
    await new Promise((r) => setTimeout(r, 10));
    expect(redraws).toBe(1);
    // Without a limit, everything, at once.
    const open = await load({ level: 'off', allowUnrated: true, allowLiveTv: true });
    expect(open.shownNow(entries, (e) => e.title, () => redraws++)).toEqual(entries);
  });

  it('waits once per list for ratings, however often it is drawn meanwhile', async () => {
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const entries = ['tt1', 'tt3'].map((id) => ({ title: title(id) }));
    let redraws = 0;
    const redraw = () => redraws++;
    // Drawn again and again while the lookups are slow (a download's progress): one wait, one redraw.
    for (let i = 0; i < 5; i++) expect(p.shownNow(entries, (e) => e.title, redraw)).toEqual([]);
    release();
    await vi.waitFor(() => expect(redraws).toBe(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(redraws).toBe(1);
    expect(p.shownNow(entries, (e) => e.title, redraw).map((e) => e.title.id)).toEqual(['tt1']);
  });

  it('draws a list again once a lookup that failed may be retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      lookupFails = true;
      const entries = [{ title: title('tt1') }];
      let shown: { title: Title }[] = [];
      let redraws = 0;
      const redraw = () => {
        redraws++;
        shown = p.shownNow(entries, (e) => e.title, redraw);
      };
      redraw();
      await vi.advanceTimersByTimeAsync(1);
      // Offline: hidden (failing closed), and drawn again once the failed lookup ended.
      expect(shown).toEqual([]);
      expect(redraws).toBe(2);
      // Nothing else happens until the retry wait is over; then it's drawn again, looked up, and shown.
      lookupFails = false;
      await vi.advanceTimersByTimeAsync(29_000);
      expect(redraws).toBe(2);
      await vi.advanceTimersByTimeAsync(1_001);
      await vi.advanceTimersByTimeAsync(1);
      expect(shown.map((e) => e.title.id)).toEqual(['tt1']);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('leaves out adult addons on a limited profile', async () => {
    const addons = [{ manifest: { behaviorHints: { adult: true } } }, { manifest: { behaviorHints: { adult: false } } }];
    expect(await (await load({ level: 'no-adult', allowUnrated: true, allowLiveTv: true })).withoutAdultAddons(addons)).toEqual([addons[1]]);
    expect(await (await load({ level: 'off', allowUnrated: true, allowLiveTv: true })).withoutAdultAddons(addons)).toEqual(addons);
  });
});
