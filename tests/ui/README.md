# Layout tests (`pnpm test:ui`)

Real pages in Chromium with Rust faked. Vite serves them on port 1421 (`playwright.config.ts`).
If Chromium is missing: `pnpm exec playwright install chromium-headless-shell`.

- `player.html` / `player-fixture.ts`: the player alone (`player.spec.ts`).
- `app.html` / `app-fixture.ts`: the whole app (`src/main.ts`) with sample data (`app.spec.ts`).

## The app fixture

Open `/tests/ui/app.html?…`, wait for `window.orbitTest`, then `await window.orbitTest.ready` (true once the
first page has settled). Onboarding (unless `fresh`), the profile picker and the launch ident are skipped.

```ts
await page.goto('/tests/ui/app.html?room=library&look=crimson');
await page.waitForFunction(() => 'orbitTest' in window);
await page.evaluate(() => window.orbitTest.ready);
```

Query parameters (all optional, combine freely):

| Parameter | Values |
| --- | --- |
| `room` | `home`, `movies`, `series`, `anime`, `explore` (Discover), `live`, `search`, `library`, `downloads`, `addons`, `settings` |
| `title` | a sample title's name or id to open its page, e.g. `title=The Last Harbor`, `title=Blackwater County` (after `room`) |
| `look` | a Look from `src/theme/looks.ts`: `orbit`, `crimson`, `marquee`, `premiere`, `glass`, `aurora`, `couch`, `afterglow`, `arc` |
| `theme` | a colour theme from `src/theme/palette.ts`, e.g. `light`, `sky` (light) or `midnight`, `amoled` (dark); applied after `look` |
| `lang` | a language id from `src/i18n`, e.g. `de`, `ja`, `ar` (right to left) |
| `set.<key>` | any setting as JSON, merged into one set above, e.g. `set.appearance={"motion":"reduce","heroStyle":"cinematic"}` |
| `profile` | the profile the app starts as: `main` (Sam, the default) or `kids` (a Kids content limit) |
| `signed-in` | (no value) Stremio, AniList, Jellyfin, Plex, Real-Debrid and TorBox answer as signed in, with made-up accounts |
| `updates` | (no value) the build updates itself: Check for updates finds Orbit 9.9.9 downloading; its outcome comes from `emit('update-ready' / 'update-failed', { version })` |
| `fresh` | (no value) a new install: one profile named "Me", only the built-in addons, no TMDB key, nothing watched or saved, never set up, so first-run setup opens over Home |

`window.orbitTest` helpers:

- `ready: Promise<boolean>`: the start page (and `room` / `title`) has settled.
- `settled(ms = 8000)`: waits until nothing is loading: no IPC for 250 ms, no skeletons or pictures loading on
  screen, finite transitions done. False if it gave up. `busy()` says what it's waiting for.
- `go(room)`: shows a top-level page as its nav item does (Settings by Ctrl+,), then settles.
- `openTitle(nameOrId)`: opens a sample title's page (through the phone-remote search bridge, so the app's own
  handlers run), then settles. Back is the title bar's back button.
- `openPlayer(nameOrId = 'The Last Harbor')`: plays a title and reports it loaded and playing (`.player.started`).
  `start()` and `status(extra)` send mpv's events as in the player fixture (an hour-long file, ten minutes in).
- `emit(event, payload)`: sends any Rust event.
- `reconnect()`: after `offline`, the connection comes back: commands and pictures work, `navigator.onLine` turns
  true and the page hears `online`; then settles.
- `data`: the sample data (`app-data.ts`): `movies`, `shows`, `byName()`, `tvChannels`…
- `settings`: the settings map (what `settings_get` answers); change it before a page reads it.
- `unanswered`: commands the fixture has no answer for (they got null); `calls`: the last 500 commands asked.

Scrolling happens in `.outlet`, not the window: `page.locator('.outlet').evaluate((el) => (el.scrollTop = 1200))`,
or use a taller viewport for a whole page. Home stays in the page (hidden) behind other pages, so look up text
with `.filter({ visible: true })`.

### Sample data

40 films and 25 shows (5 of them anime) in a Cinemeta-style catalog, with multi-season episodes; the newest
films and the ongoing shows' episodes are dated relative to today (two films are still to come). A TMDB token
is "saved", so TMDB rows, cast, ratings and services show. The profile (Sam, plus a Kids profile) has a library,
Continue Watching, history, ratings, three lists, a collection, two downloads and a Live TV source with eight
channels and a guide. Four addons are installed: Cinemeta and OpenSubtitles (built in), Sample Streams (streams
for every title) and Film Archive.

Pictures are drawn by the service worker (`sw.ts`) from their address, so nothing reaches the network
(`app.spec.ts` checks this). Stremio, Jellyfin, Plex, AniList, debrid services and the phone remote are signed out
(unless `signed-in`). Manage profiles adds, edits and deletes profiles for the page's life, and four preferences that
change nothing on screen start changed, so Settings' "Reset this section" opens its dialog on General, Playback,
Player and Subtitles (Appearance too: the fixture turns the launch animation off).

To support a new command, add an answer in `app-fixture.ts` that passes the app's schema for it.

### Faults

For unhappy paths, add any of these (they combine with the parameters above):

| Parameter | What happens |
| --- | --- |
| `offline` | `navigator.onLine` is false, every command that reaches the network fails as Rust's does with no network (TMDB's with `err.tmdb.unreachable`; Live TV's saved channels and guide still answer), and pictures don't load |
| `no-art` | Every picture fails to load (a dead CDN), everything else works |
| `empty-profile` | Nothing watched, saved, rated, listed or downloaded |
| `odd-titles` | Cinemeta's Popular (and search) starts with titles real catalogs send: one with only a name, a very long name, one unbroken word, Arabic and Japanese names, a show with no episodes, one whose episodes have only numbers (and a season missing between), one with specials only (`app-data.ts` `oddTitles`) |
| `addons-off=<key,…>` | Those installed addons are turned off, e.g. `addons-off=cinemeta` (then no addon can search) |
| `debrid-problem=<kind>` | With `signed-in`: checking Real-Debrid reports `denied`, `rate-limited`, `unreachable` or `failed` |
| `new-install` | The first launch: setup not run (it opens), one profile ("Me"), no TMDB key, no Live TV source, an empty profile, and no addons until the app installs the built-ins (which fails `offline`) |
| `fail.<command>=<mode>` | That command fails or answers oddly; `fail.tmdb_*=…` hits every command starting with `tmdb_` that reaches TMDB (not `tmdb_token_saved` and the other local ones) |
| `fail.<command>:<text>=<mode>` | Only calls whose arguments contain `<text>`, e.g. `fail.addon_request:sample-streams=timeout`; for `addon_refresh_fetch`, only that addon's manifest (Check for updates) |
| `addon.<key>=<json>` | Changes an installed addon, e.g. `addon.film-archive={"urlReadable":false}` (Reinstall needed) or `addon.sample-streams={"manifest":{}}` (a stored manifest that no longer passes) |

Modes: `network`, `timeout`, `http` / `http:<status>`, `too-large`, `rate-limited`, `error` / `error:<text>` (a plain
Rust error string), `junk` (not JSON, or the wrong JSON), `wrong-shape`, `empty` (empty lists), `null`, `hang` (never
answers), `slow` / `slow:<ms>` (answers after a wait), `blocked` / `blocked:<reason>` (an address Rust refused: `redirect`,
`scheme`, `local`), `storage` (the database couldn't be written or read), and for addon answers `repeat` (every title,
source or subtitle listed twice) and `partial` (one broken entry among the good ones). Addon commands fail with an
`AddonError`, others with a string.

Add an addon works: `addon_fetch_manifest` checks the address as Rust does (https, ends in `/manifest.json`, no query) and
answers a made-up addon named after its host (one needing setup when the path has `/configure-me/`), and installing,
removing, moving and turning addons off change the list for the page's life.

## The layout sweep (`sweep.spec.ts`)

Walks every page, two title pages and the player, in every Look, at 900, 1280 and 1920 px (the player at five
widths, controls showing and with the volume slider open), scrolled top to bottom, plus German, Arabic and a Look
switched while the app runs. On each screen `sweep.ts` lists, with no class names to know, controls and text
drawn over each other, a control half on a plate that isn't its own, controls or text cut part-way, and a page
that scrolls sideways. A failure attaches a screenshot with each problem outlined in red (`pnpm exec playwright
show-report`). `SWEEP_SHOTS=1` also saves every screen it checked to `test-results/sweep/`, to look through by
eye. Something drawn over on purpose goes in `ACCEPTED`, with why.
