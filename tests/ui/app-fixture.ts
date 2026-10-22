/**
 * The whole app (src/main.ts) in a plain browser, for layout sweeps (see README.md).
 * Rust is faked: commands answer from the sample data in app-data.ts, settings live in
 * memory for the page's life, and anything not listed answers null (and is noted in
 * `orbitTest.unanswered`). Artwork comes from the service worker (sw.ts), so nothing
 * leaves the machine.
 *
 * Query parameters: `room` (a router id: home, movies, series, anime, explore, live, search,
 * library, downloads, addons, settings), `look` (theme/looks.ts LOOK_IDS), `theme` (a
 * palette preset, e.g. light), `lang` (an i18n language id), `title` (an id or name to open)
 * `profile` (a sample profile's id, `main` unless given) and `set.<key>` (any setting, as JSON). See README.md for the `window.orbitTest` helpers.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import * as data from './app-data';
import type { AppTest } from './orbit-test';

const params = new URLSearchParams(location.search);

// Artwork first: the worker must control the page before any <img> asks for its picture.
await navigator.serviceWorker.register('/tests/ui/sw.ts', { type: 'module', scope: '/tests/ui/' });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) {
  await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
}

/** Settings as Rust keeps them (settings_get / settings_set), for this page's life. */
const store = new Map<string, unknown>(
  Object.entries({
    // Past first-run setup and its Home card.
    'onboarding.done': true,
    'onboarding.checklist': { dismissed: true, profilesSeen: true },
    'home.welcome-dismissed': true,
    'profiles.last': 'main',
    'streaming.region': 'US',
    // No launch ident over the first page.
    fun: { intro: false },
    // A few changed preferences that change nothing on screen, so "Reset this section" lists them (rather than "nothing to reset").
    'general.close': 'tray',
    'playback.same-source': false,
    'player.number-jump': false,
    'player.subtitle-forced-only': true,
  }),
);

/**
 * `new-install`: Orbit's very first launch. Setup hasn't run, there's one profile (Rust's "Me"), no TMDB token,
 * no Live TV source, nothing watched or saved, and no addons yet: the app installs the built-ins (Cinemeta and
 * OpenSubtitles) itself, which fails while `offline`. Implies `empty-profile`.
 */
const newInstall = params.has('new-install');
if (newInstall) {
  for (const key of ['onboarding.done', 'onboarding.checklist', 'home.welcome-dismissed', 'profiles.last', 'streaming.region']) store.delete(key);
  data.profiles.splice(0, data.profiles.length, { ...data.profiles[0]!, name: 'Me' });
}

const lang = params.get('lang');
if (lang) {
  store.set('general.language', lang);
  // i18n reads its mirror as it loads, so the language is right from the first frame (no reload).
  localStorage.setItem('orbit.language', lang);
} else {
  localStorage.removeItem('orbit.language');
}

const lookId = params.get('look');
if (lookId) {
  const { findLook } = await import('../../src/theme/looks');
  const look = findLook(lookId);
  if (!look) throw new Error(`No Look "${lookId}"`);
  store.set('theme', look.theme);
  store.set('appearance', { ...look.appearance, ...(look.scale ? { scale: look.scale } : {}) });
  store.set('theme.layout', { ...look.nav });
  store.set('player.layout', { ...look.player });
  if (look.fonts) store.set('theme.fonts', look.fonts);
}
const themeId = params.get('theme');
if (themeId) store.set('theme', themeId);
// Any other setting, as JSON: `?set.appearance={"motion":"reduce"}` (merged into an object already set above).
for (const [name, value] of params) {
  if (!name.startsWith('set.')) continue;
  const key = name.slice(4);
  const parsed: unknown = JSON.parse(value);
  const before = store.get(key);
  const merge = typeof before === 'object' && before !== null && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  store.set(key, merge ? { ...before, ...parsed } : parsed);
}

/**
 * Unhappy paths (README.md "Faults"): `offline`, `no-art`, `empty-profile`, and `fail.<command>[:<text>]=<mode>`,
 * which makes a command (or every command starting with it, with a trailing `*`) fail or answer oddly. With `:<text>`
 * only calls whose arguments contain that text are hit, e.g. `fail.addon_request:sample-streams=timeout`.
 */
const offline = params.has('offline');
const noArt = params.has('no-art') || offline;
const faults: { cmd: string; prefix: boolean; match: string | null; mode: string; offline?: true }[] = [];
for (const [name, mode] of params) {
  if (!name.startsWith('fail.')) continue;
  const [cmd, ...match] = name.slice(5).split(':');
  faults.push({ cmd: cmd!.replace(/\*$/, ''), prefix: cmd!.endsWith('*'), match: match.length ? match.join(':') : null, mode });
}
// Offline: every command that reaches the network fails as Rust's would, and the page hears the browser is offline.
// Live TV's channels and guide aren't among them: Rust reads those from its database (iptv/mod.rs), offline or not.
const NETWORK = ['addon_request', 'addon_fetch_manifest', 'tmdb_*', 'letterboxd_*', 'explore_*', 'anilist_characters', 'avatar_save_url', 'art_fetch', 'skip_segments', 'aniskip_segments', 'iptv_add', 'iptv_refresh', 'iptv_account'];
/** Commands a `tmdb_*` (or offline) fault leaves alone: Rust answers them from the keychain or the database. */
const LOCAL = new Set(['tmdb_token_saved', 'tmdb_set_language', 'tmdb_set_region', 'tmdb_clear_token']);
if (offline) {
  for (const cmd of NETWORK) faults.push({ cmd: cmd.replace(/\*$/, ''), prefix: cmd.endsWith('*'), match: null, mode: 'network', offline: true });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
}

/** The connection comes back (after `offline`): commands and pictures work again and the page hears `online`. */
async function reconnect(): Promise<boolean> {
  for (let i = faults.length - 1; i >= 0; i--) if (faults[i]!.offline) faults.splice(i, 1);
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  // The service worker hears it first (it answers), so pictures asked for on `online` are drawn.
  const worker = navigator.serviceWorker.controller;
  if (worker && !params.has('no-art')) {
    const answered = new MessageChannel();
    await new Promise((resolve) => {
      answered.port1.onmessage = resolve;
      worker.postMessage({ noArt: false }, [answered.port2]);
    });
  }
  window.dispatchEvent(new Event('online'));
  return settled();
}
if (noArt) navigator.serviceWorker.controller?.postMessage({ noArt: true });

/**
 * Services whose Rust commands fail with a code rather than a sentence (tmdb.rs `get`, letterboxd.rs, awards.rs):
 * what each of the network modes becomes there.
 */
const CODED: [prefix: string, code: string, coded: Record<string, string>][] = [
  ['tmdb_', 'tmdb', { network: 'unreachable', timeout: 'timeout', 'http:401': 'signed-out', 'http:429': 'busy', 'rate-limited': 'busy', http: 'unreachable', 'too-large': 'unreachable' }],
  ['letterboxd_', 'letterboxd', { network: 'unreachable', timeout: 'unreachable', http: 'unreachable', 'rate-limited': 'unreachable', 'too-large': 'unreachable' }],
  ['explore_award', 'wikidata', { network: 'unreachable', timeout: 'timeout', http: 'unreachable', 'rate-limited': 'unreachable', 'too-large': 'unreachable' }],
];

/** What a fault does to a command's answer (`real` is the answer it would have given). */
async function fault(mode: string, cmd: string, real: () => unknown): Promise<unknown> {
  const addon = cmd.startsWith('addon_');
  // TMDB's commands answer with coded errors (tmdb.rs `get_limited`), not reqwest's text.
  const tmdb = cmd.startsWith('tmdb_');
  const [kind, arg] = mode.split(':') as [string, string | undefined];
  const service = CODED.find(([prefix]) => cmd.startsWith(prefix));
  const coded = service && (service[2][mode] ?? service[2][kind]);
  if (service && coded) throw `err.${service[1]}.${coded}`;
  switch (kind) {
    case 'network': throw addon ? { kind: 'network', message: 'error sending request: dns error (layout fixture)' } : tmdb ? 'err.tmdb.unreachable' : 'error sending request: dns error (layout fixture)';
    case 'timeout': throw addon ? { kind: 'timeout' } : tmdb ? 'err.tmdb.timeout' : 'operation timed out (layout fixture)';
    case 'http': throw addon ? { kind: 'http', status: Number(arg ?? 500) } : tmdb ? (arg === '401' ? 'err.tmdb.signed-out' : 'err.tmdb.unreachable') : `HTTP ${arg ?? 500} (layout fixture)`;
    // Rust's limits: 256 KB for a manifest, 4 MB for anything else.
    case 'too-large': throw tmdb ? 'err.tmdb.unreachable' : { kind: 'too-large', limitBytes: (cmd === 'addon_fetch_manifest' || cmd === 'addon_refresh_fetch' ? 256 : 4096) * 1024 };
    case 'rate-limited': throw tmdb ? 'err.tmdb.busy' : { kind: 'rate-limited', retryAfterSecs: 30 };
    case 'error': throw arg ?? 'something went wrong (layout fixture)';
    // An addon address Rust refused: `scheme` (not https), `redirect` (sent somewhere else), `local` (the home network).
    case 'blocked': throw { kind: 'blocked', reason: arg ?? 'redirect' };
    // A row the database couldn't write (a locked or full disk), as Rust's AddonError::Storage.
    case 'storage': throw { kind: 'storage', message: 'database is locked (layout fixture)' };
    // Not JSON at all (an HTML error page from a proxy), or JSON of the wrong shape.
    case 'junk': return addon ? '<html><body>502 Bad Gateway</body></html>' : { junk: true, metas: 'nope' };
    case 'wrong-shape': return addon ? JSON.stringify({ metas: [{ id: 42, name: null }], streams: 'none', meta: [], subtitles: {} }) : [{ nonsense: 1 }];
    case 'empty': return addon ? JSON.stringify({ metas: [], streams: [], subtitles: [], meta: null, addons: [] }) : [];
    case 'null': return null;
    // An addon's lists with every title twice, or with one broken entry among the good ones.
    case 'repeat':
    case 'partial': {
      const answer = JSON.parse(String(await real())) as Record<string, unknown>;
      for (const key of ['metas', 'streams', 'subtitles']) {
        const list = answer[key];
        if (Array.isArray(list)) answer[key] = kind === 'repeat' ? [...list, ...list] : [{ id: 42, name: null }, ...list];
      }
      return JSON.stringify(answer);
    }
    case 'hang': return new Promise(() => {});
    case 'slow': await new Promise((r) => setTimeout(r, Number(arg ?? 5000))); return real();
    default: throw new Error(`Unknown fault mode "${mode}"`);
  }
}
/** Commands whose `:<text>` faults hit one entry of their answer (an addon's manifest), not the whole command. */
const PER_ENTRY = ['addon_refresh_fetch'];
function faultFor(cmd: string, args: unknown, entry = false): string | null {
  for (const f of faults) {
    if (f.prefix ? !cmd.startsWith(f.cmd) || LOCAL.has(cmd) : cmd !== f.cmd) continue;
    if (!entry && f.match !== null && PER_ENTRY.includes(cmd)) continue;
    if (f.match !== null && !JSON.stringify(args ?? {}).includes(f.match)) continue;
    return f.mode;
  }
  return null;
}

/** `signed-in`: Stremio, AniList, Jellyfin, Plex and two debrid services answer as signed in (made-up accounts). */
const signedIn = params.has('signed-in');

/** Commands asked that have no answer here (they got null). */
const unanswered = new Set<string>();
/** The last 500 commands asked, with their arguments. */
const calls: [string, unknown][] = [];
/** IPC calls not yet answered, and when the last one was made: the page is settled once it's quiet. */
let pending = 0;
let lastCall = performance.now();
/** The player numbers each file it opens (`load`); its events must carry the same number. */
let load = 0;
/** What the last remote search found (remote_search_results), for `openTitle`. */
let found: { id: number; results: { name: string }[] } | null = null;

type Args = Record<string, unknown>;
/** The wallpaper Settings → Appearance saved (none to start with). */
let wallpaper = new ArrayBuffer(0);

/** Installed addons' addresses (only Rust knows them), by key: installing one again updates it in place. */
const addonUrls = new Map<string, string>();
/** An addon address as Rust's `parse_transport_url` reads it, or the AddonError it fails with. */
function transportUrl(input: string): URL {
  const invalid = (reason: string) => ({ kind: 'invalid-url', reason });
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^stremio:\/\//i, 'https://'));
  } catch {
    throw invalid('not-url');
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw { kind: 'blocked', reason: 'scheme' };
  if (url.username || url.password) throw invalid('credentials');
  if (url.search) throw invalid('query');
  if (!url.pathname.endsWith('/manifest.json')) throw invalid('manifest-path');
  url.hash = '';
  return url;
}
const page = <T>(list: T[], n: unknown, size = 20) => ({ titles: list.slice((Number(n) - 1) * size, Number(n) * size), done: Number(n) * size >= list.length });

/** A small PNG coloured from `seed`, for picture bytes Rust hands over (`art_fetch` for the ambient tint, a download's poster). */
async function artBytes(seed: string): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(200, 300);
  const g = canvas.getContext('2d')!;
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  const fill = g.createLinearGradient(0, 0, 200, 300);
  fill.addColorStop(0, `hsl(${hue} 55% 42%)`);
  fill.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 14%)`);
  g.fillStyle = fill;
  g.fillRect(0, 0, 200, 300);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** Commands that only tell Rust something (or whose null answer is the real one when a service is off). */
const QUIET = [
  'tmdb_set_language', 'tray_labels', 'theme_image_prune', 'download_schedule_set', 'remote_now_playing', 'diagnostics_startup', 'diagnostics_log',
  'iptv_refresh_stale', 'iptv_vod_prepare', 'media_controls_set', 'media_controls_clear', 'discord_set_activity', 'discord_clear', 'watch_next_publish',
  'stremio_library_pull', 'watch_put_title', 'watch_put_progress', 'thumbs_start', 'thumbs_stop', 'player_stop', 'player_lift_subtitles', 'player_set_paused', 'trailer_preview',
];

/** `addon.<key>=<json>`: changes an installed addon, e.g. `addon.film-archive={"urlReadable":false}` (its address can't be decrypted) or `{"manifest":{}}` (a stored manifest that no longer passes the schema). */
for (const [name, value] of params) {
  if (!name.startsWith('addon.')) continue;
  const addon = data.addons.find((a) => a.key === name.slice(6));
  if (!addon) throw new Error(`No addon "${name.slice(6)}"`);
  Object.assign(addon, JSON.parse(value) as object);
}

/** `empty-profile`: a new profile, with nothing watched, saved, rated, listed or downloaded. */
if (params.has('empty-profile') || newInstall) {
  for (const cmd of ['library_list', 'list_all', 'rating_all', 'favourite_episode_all', 'collection_all', 'download_list']) faults.push({ cmd, prefix: false, match: null, mode: 'empty' });
}
const emptyProfile = params.has('empty-profile') || newInstall;
/** The built-ins by their manifest address, as a new install fetches and installs them. */
const BUILTINS: Record<string, (typeof data.addons)[number]> = {
  'https://v3-cinemeta.strem.io/manifest.json': data.addons[0]!,
  'https://opensubtitles-v3.strem.io/manifest.json': data.addons[1]!,
};
// The installed addons (Rust's list): none yet on a new install, until the built-ins are.
if (newInstall) data.addons.splice(0);
/** Without a TMDB token Rust answers its TMDB commands with null before reaching the network (tmdb.rs, awards.rs). */
const noToken = (cmd: string) => newInstall && ((cmd.startsWith('tmdb_') && cmd !== 'tmdb_token_saved' && cmd !== 'tmdb_set_token') || cmd === 'explore_award');
const noTvSources = faultFor('iptv_sources', {}) === 'empty';
/**
 * `tv-many`: a provider's list as big ones come, 20,000 channels in 400 groups (one group very long),
 * many without a logo, some without a group and some with long names.
 */
const manyChannels = params.has('tv-many')
  ? Array.from({ length: 20_000 }, (_, i) => ({
      source: 'tv1',
      key: `m${i}`,
      name: i % 97 === 0 ? `|UK| Channel ${i} FHD ᴿᴬᵂ — Regional Variant With A Very Long Name For Testing ${i}` : `Channel ${i}`,
      logo: i % 3 === 0 ? null : `https://art.orbit.test/channel/ch-${i}.svg`,
      group: i % 50 === 0 ? null : i < 5000 ? 'UK | Entertainment' : `Group ${i % 400}`,
      favourite: false,
      rank: null,
      listed: i % 2 === 0,
      archive: 0,
    }))
  : null;
const manyGroups = manyChannels && {
  groups: [...manyChannels.reduce((counts, c) => (c.group ? counts.set(c.group, (counts.get(c.group) ?? 0) + 1) : counts), new Map<string, number>())].map(([name, count]) => ({ name, count, hidden: false, locked: false })),
  unlocked: false,
  pinSet: false,
};
/** `addons-off=cinemeta,film-archive`: those installed addons start turned off. */
for (const key of (params.get('addons-off') ?? '').split(',').filter(Boolean)) data.addons.find((a) => a.key === key)!.enabled = false;
/** `odd-titles`: titles with missing artwork and details, very long or right-to-left names, and odd episode lists (app-data.ts). */
if (params.has('odd-titles')) data.addOddTitles();

const answers: Record<string, (args: Args) => unknown> = {
  settings_get: ({ key }) => store.get(key as string) ?? null,
  settings_set: ({ key, value }) => void store.set(key as string, value),

  // Profiles (Manage profiles changes them for the page's life, as Rust would)
  profile_list: () => data.profiles,
  // `profile=<id>`: start as another profile (`kids` has a content limit).
  profile_active: () => params.get('profile') ?? 'main',
  profile_select: () => null,
  profile_create: ({ name, color, avatar }) => {
    const profile = { id: `p${data.profiles.length + 1}`, name: String(name).trim(), color: color as string, avatar: (avatar as string | null) ?? null, addonsFrom: null, hasPin: false, contentLimit: { level: 'off', allowUnrated: true, allowLiveTv: true } };
    data.profiles.push(profile);
    return profile;
  },
  profile_update: ({ id, name, color, avatar }) => void Object.assign(data.profiles.find((p) => p.id === id)!, { name: String(name).trim(), color: color as string, avatar: avatar as string | null }),
  profile_delete: ({ id }) => void data.profiles.splice(data.profiles.findIndex((p) => p.id === id), 1),
  profile_set_pin: ({ pin }) => void (data.profiles.find((p) => p.id === 'main')!.hasPin = pin !== null),
  profile_set_limit: ({ id, limit }) => void (data.profiles.find((p) => p.id === id)!.contentLimit = limit as data.Profile['contentLimit']),
  profile_set_addons_from: ({ id, from }) => void (data.profiles.find((p) => p.id === id)!.addonsFrom = from as string | null),
  // The avatar picker: TMDB's popular shows and a title's cast (no AniList match), a picture saved from one.
  tmdb_trending_shows: () => data.titleHits(data.mix(data.shows, 3).slice(0, 8)),
  tmdb_search_titles: ({ query }) => data.titleHits(data.allTitles.filter((m) => m.name.toLowerCase().includes(String(query).toLowerCase())).slice(0, 20)),
  tmdb_cast_by_id: ({ id }) => {
    const m = data.allTitles.find((x) => data.tmdbId(x) === id);
    return m ? data.cast(m).map((c) => ({ ...c, still: data.tmdbArt('background', `${m.name} ${c.name}`) })) : [];
  },
  anilist_characters: () => null,
  avatar_save_url: () => 'upload-00000000000000c1',
  avatar_get: ({ name }) => artBytes(String(name)),

  // Addons
  addon_list: () => data.addons,
  addon_removed_list: () => [],
  addon_request: ({ key, path }) => {
    // `streams=<kind>`: Sample Streams answers oddly (see streamVariant).
    const variant = params.get('streams');
    if (variant && key === 'sample-streams') return JSON.stringify(data.streamVariant(variant, path as string));
    const answer = data.addonAnswer(key as string, path as string);
    if (answer === null) throw { kind: 'not-found' };
    return JSON.stringify(answer);
  },
  // The address is checked as Rust's parse_transport_url does; any good one answers a made-up addon named after its host.
  // The built-ins answer their own manifests (a new install fetches and installs them).
  addon_fetch_manifest: ({ url }) => JSON.stringify(BUILTINS[url as string]?.manifest ?? data.manifestAt(transportUrl(String(url)))),
  addon_install: ({ url, manifest, replace }) => {
    const builtIn = BUILTINS[url as string];
    if (builtIn) {
      if (!data.addons.includes(builtIn)) data.addons.push(builtIn);
      return builtIn;
    }
    const at = transportUrl(String(url));
    const key = (replace as string | undefined) ?? addonUrls.get(at.href) ?? `added-${addonUrls.size + 1}`;
    addonUrls.set(at.href, key);
    const before = data.addons.findIndex((a) => a.key === key);
    const addon = { ...data.addons[before], ...data.installedAddon(key, manifest as object, at.host, false, Date.now()) };
    if (before < 0) data.addons.push(addon);
    else data.addons[before] = addon;
    return addon;
  },
  addon_set_enabled: ({ key, enabled }) => void (data.addons.find((a) => a.key === key)!.enabled = enabled as boolean),
  addon_move: ({ key, index }) => {
    const from = data.addons.findIndex((a) => a.key === key);
    const [moved] = data.addons.splice(from, 1);
    data.addons.splice(Math.min(Number(index), data.addons.length), 0, moved!);
  },
  addon_remove: ({ key }) => void data.addons.splice(data.addons.findIndex((a) => a.key === key), 1),

  // The profile's things
  library_list: () => data.library,
  watch_list: () => (emptyProfile ? { titles: [], progress: [] } : data.watchList()),
  list_all: () => data.lists,
  rating_all: () => data.ratings,
  favourite_episode_all: () => data.favouriteEpisodes,
  collection_all: () => data.collections,
  download_list: () => data.downloads,
  download_storage: () => ({ folder: 'D:\\Orbit\\Downloads', used: 4.2e9 + 1.7e9, free: 812e9 }),

  // Live TV
  iptv_sources: () => (newInstall ? [] : data.tvSources),
  // `fail.iptv_sources=empty`: no source, so (as in Rust) no channels or groups either.
  iptv_channels: () => (noTvSources || newInstall ? [] : (manyChannels ?? data.tvChannels)),
  iptv_guide: ({ channels }) => data.tvGuide(channels as [string, string][]),
  iptv_schedule: ({ channels, from, to }) => (channels as [string, string][]).map(([source, key]) => ({ source, key, programmes: data.tvProgrammes(key, from as number, to as number) })),
  iptv_groups: () => (noTvSources || newInstall ? { ...data.tvGroups, groups: [] } : (manyGroups ?? data.tvGroups)),
  iptv_guides: () => ({ own: [], fallback: 'provider' }),
  iptv_account: () => data.tvSources[0]!.account,
  // Adding checks the source by downloading its channels; here every source has the sample's eight.
  iptv_add: ({ source }) => {
    const { kind, name } = source as { kind: 'm3u' | 'xtream'; name: string };
    const added = { ...data.tvSources[0]!, id: `tv${data.tvSources.length + 1}`, name: name.trim(), kind, useVod: kind === 'xtream', channelsAt: Date.now() };
    data.tvSources.push(added);
    return added;
  },
  iptv_refresh: () => null,
  iptv_remove: ({ id }) => void data.tvSources.splice(data.tvSources.findIndex((s) => s.id === id), 1),
  iptv_vod_sources: () => [],

  // TMDB (a token is saved; Rust would answer from TMDB)
  tmdb_token_saved: () => !newInstall,
  tmdb_list: ({ list }) => data.tmdbTitles(list === 'movies-today' ? data.mix(data.movies, 7).slice(0, 10) : list === 'series-today' ? data.mix(data.shows, 5).slice(0, 10) : data.mix(data.allTitles, 11).slice(0, 20)),
  tmdb_recommendations: ({ imdbId }) => data.tmdbTitles(data.mix(data.allTitles, Number(String(imdbId).slice(-2)) + 3).filter((m) => m.id !== imdbId).slice(0, 12)),
  tmdb_services: () => data.services,
  tmdb_streaming: ({ service }) => data.tmdbTitles(data.mix(data.allTitles, String(service).length + 13).slice(0, 20)),
  tmdb_service_page: ({ service, kind, page: n }) => page(data.tmdbTitles(data.mix(kind === 'series' ? data.shows : data.movies, String(service).length + 2)), n),
  tmdb_source_page: ({ source, page: n }) => page(data.tmdbTitles(data.tmdbDiscover(source as Parameters<typeof data.tmdbDiscover>[0])), n),
  explore_award: ({ page: n }) => page(data.tmdbTitles([...data.movies].sort((a, b) => Number(b.imdbRating) - Number(a.imdbRating))), n),
  // A title TMDB doesn't know: an empty cast, as Rust answers.
  tmdb_cast: ({ imdbId }) => {
    const m = data.byId.get(imdbId as string);
    return m ? data.cast(m) : [];
  },
  tmdb_person: ({ id }) => {
    const known = data.mix(data.allTitles, Number(id) % 50).slice(0, 8);
    return { name: known[0]!.cast[Number(id) % 6] ?? 'Ava Calloway', biography: 'An actor known for quiet, careful performances in drama and thrillers, and the occasional comedy.', birthday: '1984-03-12', deathday: null, placeOfBirth: 'Dublin, Ireland', photo: data.tmdbArt('face', 'person'), knownFor: data.tmdbTitles(known) };
  },
  tmdb_search_people: ({ query }) => data.allTitles.flatMap((m) => m.cast).filter((n, i, all) => all.indexOf(n) === i && n.toLowerCase().includes(String(query).toLowerCase())).slice(0, 6).map((name, i) => ({ id: 500 + i, name, photo: data.tmdbArt('face', name), knownFor: data.allTitles.filter((m) => m.cast.includes(name)).slice(0, 3).map((m) => m.name) })),
  tmdb_title_collection: () => ({ franchise: null }),
  tmdb_genre_art: ({ genres }) => Object.fromEntries((genres as number[]).map((g) => [String(g), data.mix(data.movies, g % 90).slice(0, 3).map((m) => data.tmdbArt('background', m.name))])),
  tmdb_movie_certifications: () => ({ country: 'US', certifications: ['G', 'PG', 'PG-13', 'R', 'NC-17'] }),
  tmdb_find_title: ({ imdbId }) => {
    const m = data.byId.get(imdbId as string);
    return m ? data.tmdbTitles([m]) : [];
  },
  tmdb_extras: ({ imdbId }) => {
    const m = data.byId.get(imdbId as string);
    if (!m) return null;
    return {
      tmdb_id: Number(m.id.slice(2)) - 9_000_000,
      rating: Number(m.imdbRating) - 0.2,
      logos: [{ name: m.name, logo: data.tmdbArt('logo', m.name) }],
      name: null,
      overview: null,
      votes: 1200 + Number(m.id.slice(-2)) * 37,
      status: m.type === 'movie' ? 'released' : m.status === 'Ended' ? 'ended' : 'returning',
      companies: ['Northlight Pictures', 'Harbour Films'],
      language: 'en',
      genres: m.genres,
      budget: m.type === 'movie' ? 42_000_000 : null,
      revenue: m.type === 'movie' ? 131_500_000 : null,
      videos: [],
      images: { backdrops: [1, 2, 3].map((n) => ({ thumb: data.tmdbArt('background', `${m.name} ${n}`), full: data.tmdbArt('background', `${m.name} ${n}`) })), posters: [], logos: [] },
    };
  },
  tmdb_title_topics: () => ({
    keywords: ['based on novel', 'small town', 'family secrets', 'slow burn'].map((name, i) => ({ id: 100 + i, name })),
    providers: { stream: data.services.slice(0, 2).map((s, i) => ({ id: 8 + i, name: s.name, logo: s.logo! })), rent: [], buy: [] },
  }),
  tmdb_release_dates: () => [],
  tmdb_certifications: ({ titles }) => (titles as { id: string }[]).map(({ id }) => ({ id, certs: { US: data.certification(id) }, adult: false })),
  tmdb_season_ratings: ({ imdbId, season }) =>
    (data.byId.get(imdbId as string)?.videos ?? []).filter((v) => v.season === season && Date.parse(v.released) < data.NOW).map((v) => ({ episode: v.episode, rating: 6.4 + ((v.episode * 7 + v.season * 3) % 30) / 10, votes: 40 + v.episode * 9 })),
  tmdb_story_arcs: () => [],
  letterboxd_profile: ({ input }) => ({ user: String(input).trim(), name: 'Sam' }),
  letterboxd_rating: ({ imdbId }) => {
    const m = data.byId.get(imdbId as string);
    return m ? Math.round(Number(m.imdbRating) * 5) / 10 : null;
  },
  // Discover's Letterboxd list sections: one page of films (Rust matched them to IMDb ids and TMDB art), then the list's end.
  letterboxd_list: ({ slug, page: n }) =>
    Number(n) > 1 ? [] : data.mix(data.movies, String(slug).length + 5).slice(0, 18).map((m) => ({ imdbId: m.id, name: m.name, poster: data.tmdbArt('poster', m.name), background: data.tmdbArt('background', m.name), year: m.releaseInfo.slice(0, 4), overview: m.description, rating: null, liked: false })),
  letterboxd_reviews: ({ imdbId }) => ({
    url: `https://letterboxd.com/film/${String(imdbId)}/`,
    reviews: [
      { author: 'nightowl', avatar: null, rating: 4, liked: true, spoilers: false, text: 'Quietly devastating. The last twenty minutes stayed with me for days.', url: 'https://letterboxd.com/nightowl/' },
      { author: 'popcornpilot', avatar: null, rating: 3.5, liked: false, spoilers: false, text: 'Gorgeous to look at, a little long in the middle, but that score carries it.', url: 'https://letterboxd.com/popcornpilot/' },
    ],
  }),

  // Status of services that are off (or, with `signed-in`, accounts made up here: never real ones)
  stremio_signed_in: () => signedIn,
  stremio_account: () => (signedIn ? { email: 'sam.longname-for-testing@example.com' } : null),
  stremio_logout: () => null,
  stremio_login: (a) => ({ email: String(a.email) }),
  // Signing in through the browser finishes later, with `stremio://signed-in` (a test emits it).
  stremio_browser_login: () => null,
  stremio_addons: () => [{ index: 0, host: 'addon.example.com', official: false, manifest: { id: 'com.example.sample', version: '1.0.0', name: 'Sample addon', types: ['movie'], resources: ['stream'] } }],
  stremio_install_addon: () => null,
  // `updates`: this build updates itself, and every check finds a new Orbit downloading (its events come from `emit`).
  update_status: () => ({ enabled: params.has('updates'), busy: false, ready: null }),
  update_check: () => (params.has('updates') ? { state: 'downloading', version: '9.9.9' } : { state: 'off' }),
  remote_status: () => ({ running: false, address: null, pairUrl: null, code: null, expiresIn: null, qr: null, devices: 0, maxDevices: 3, locked: false }),
  anilist_status: () => (signedIn ? { configured: true, account: { id: 4821, name: 'SamWatchesEverything', avatar: null }, enabled: true, connected: true, error: null } : { configured: false, account: null, enabled: false, connected: false, error: null }),
  connect_status: () => ({ running: false, name: null, kind: 'pc', expiresIn: null, locked: false, prompt: null, devices: [], maxDevices: 0 }),
  wallpaper_get: () => wallpaper,
  // The bytes come as the raw body, as Rust takes them.
  wallpaper_set: (bytes) => void (wallpaper = (bytes as unknown as Uint8Array).slice().buffer),
  wallpaper_clear: () => void (wallpaper = new ArrayBuffer(0)),
  art_fetch: ({ url }) => artBytes(url as string),
  download_art: ({ id }) => artBytes(String(id)),
  // Each addon's manifest fetched again, as Rust answers: one entry per addon, failing on its own (offline, an
  // unreadable address, or `fail.addon_refresh_fetch:<key>=<mode>`) rather than the whole command failing.
  addon_refresh_fetch: async ({ key }) =>
    Promise.all(
      data.addons
        .filter((a) => key === undefined || a.key === key)
        .map(async (a) => {
          if (!a.urlReadable) return { key: a.key, body: null, error: { kind: 'reinstall-needed' } };
          const mode = !navigator.onLine ? 'network' : faultFor('addon_refresh_fetch', { key: a.key }, true);
          if (!mode) return { key: a.key, body: JSON.stringify(a.manifest), error: null };
          try {
            const body = await fault(mode, 'addon_refresh_fetch', () => JSON.stringify(a.manifest));
            return { key: a.key, body, error: null };
          } catch (error) {
            return { key: a.key, body: null, error };
          }
        }),
    ),
  addon_refresh_apply: ({ updates }) => (updates as { key: string }[]).map(({ key }) => ({ key, outcome: 'unchanged' })),
  debrid_accounts: () =>
    signedIn
      ? [
          { provider: 'realdebrid', name: 'Real-Debrid', userName: 'sam_streams', premiumUntil: data.NOW + 90 * 86_400_000 },
          { provider: 'torbox', name: 'TorBox', userName: 'sam@example.com', premiumUntil: null },
        ]
      : [],
  // `debrid-problem=<kind>` (denied, rate-limited, unreachable, failed): Real-Debrid couldn't be checked, as debrid.rs `problem` says.
  debrid_check: () => {
    const kind = params.get('debrid-problem');
    return { accounts: answers.debrid_accounts!({}), problems: kind ? [{ provider: 'realdebrid', kind, retryIn: kind === 'rate-limited' ? 30 : null }] : [] };
  },
  jellyfin_status: () => (signedIn ? { serverName: 'Living Room Jellyfin Server', userName: 'Sam', host: 'http://192.168.1.20:8096', insecure: true } : null),
  plex_status: () => (signedIn ? { serverName: 'Basement Plex Media Server', userName: 'sam.plex', host: 'https://plex.example.com:32400', insecure: false } : null),
  deep_link_take: () => null,

  // Search via the phone remote's bridge (openTitle)
  remote_search_results: (args) => void (found = args as typeof found),

  // Playback
  player_open: (args) => void (load = (args as { load: number }).load),
  player_audio_devices: () => ({ devices: [{ name: 'wasapi/speakers', description: 'Speakers (Realtek Audio)' }, { name: 'wasapi/headphones', description: 'Headphones (USB Audio)' }], active: 'auto' }),
  player_info: () => ({ width: '3840', height: '2160', videoCodec: 'hevc', audioCodec: 'eac3', fps: '23.976', hwdec: 'd3d11va' }),
  skip_segments: () => [],
  aniskip_segments: () => [],
};

/**
 * `fresh`: a new install, as Rust starts one: never set up, one profile named "Me", only the built-in
 * addons, no TMDB key, nothing watched or saved. First-run setup opens over Home.
 */
if (params.has('fresh')) {
  for (const key of ['onboarding.done', 'onboarding.checklist', 'home.welcome-dismissed', 'profiles.last', 'general.close', 'playback.same-source', 'player.number-jump', 'player.subtitle-forced-only']) store.delete(key);
  data.profiles.splice(0, data.profiles.length, { ...data.profiles[0]!, name: 'Me' });
  data.addons.splice(0, data.addons.length, ...data.addons.filter((a) => a.builtIn));
  for (const list of [data.library, data.lists, data.ratings, data.favouriteEpisodes, data.collections, data.downloads, data.tvSources] as unknown[][]) list.splice(0);
  answers.watch_list = () => ({ progress: [], titles: [] });
  answers.tmdb_token_saved = () => false;
}

mockWindows('main');
mockIPC(
  (cmd, args) => {
    const answer = answers[cmd];
    if (!answer && !cmd.startsWith('plugin:') && !cmd.startsWith('player_set_') && !QUIET.includes(cmd)) unanswered.add(cmd);
    pending++;
    lastCall = performance.now();
    calls.push([cmd, args]);
    if (calls.length > 500) calls.shift();
    try {
      // A new install's token check reads the (empty) keychain, offline or not.
      if (newInstall && cmd === 'tmdb_token_saved') return (pending--, false);
      const mode = noToken(cmd) ? 'null' : faultFor(cmd, args);
      const value = mode ? fault(mode, cmd, () => (answer ? answer((args ?? {}) as Args) : null)) : answer ? answer((args ?? {}) as Args) : null;
      return value instanceof Promise ? value.finally(() => pending--) : (pending--, value);
    } catch (err) {
      pending--;
      throw err;
    }
  },
  { shouldMockEvents: true },
);

await import('../../src/main');

// ── Helpers for sweeps ──

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const outlet = () => document.querySelector<HTMLElement>('.outlet');
/** In the window and shown (not in a page kept hidden, nor scrolled out of a rail). */
function onScreen(el: Element): boolean {
  const box = el.getBoundingClientRect();
  if (!(box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth)) return false;
  if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
  // Clipped away by a scrolling ancestor (a rail, a list in the banner)?
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    if (getComputedStyle(at).overflow === 'visible') continue;
    const clip = at.getBoundingClientRect();
    if (box.right <= clip.left || box.left >= clip.right || box.bottom <= clip.top || box.top >= clip.bottom) return false;
  }
  return true;
}
const LOADING ='.skeleton, .poster-skeleton, [aria-busy="true"]';
/** Why the page isn't settled yet (empty when it is): IPC in flight or just made, skeletons, pictures still loading. */
function busy(): string[] {
  const why: string[] = [];
  if (pending > 0) why.push(`${pending} IPC calls pending`);
  if (performance.now() - lastCall < 250) why.push('IPC just called');
  // Only on screen: sections further down (Discover's) stay skeletons until they're scrolled near.
  const skeleton = [...(outlet()?.querySelectorAll<HTMLElement>(LOADING) ?? [])].find(onScreen);
  if (skeleton) why.push(`loading: ${skeleton.className || skeleton.tagName} in ${skeleton.parentElement?.className ?? '?'} / ${skeleton.closest('section')?.className ?? '?'}`);
  // Only pictures on screen (hidden ones, e.g. a banner's next slides, may wait to load).
  const image = [...document.images].find((img) => !img.complete && onScreen(img));
  if (image) why.push(`image: ${image.src}`);
  return why;
}

/** Resolves once the page has drawn: no IPC for a moment, no skeletons, pictures loaded (gives up after `ms`). */
async function settled(ms = 8000): Promise<boolean> {
  const end = performance.now() + ms;
  await wait(50);
  while (performance.now() < end) {
    if (!busy().length) {
      // Let finite transitions (pictures fading in, a row sliding in) end; looping ones never do.
      const ending = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity));
      await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => undefined))), wait(1500)]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (busy().length) continue;
      return true;
    }
    await wait(50);
  }
  return false;
}

/** Shows a top-level page, as its nav item does (Settings by its shortcut, which isn't in the nav). */
async function go(room: string): Promise<boolean> {
  if (room === 'settings') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true, cancelable: true }));
  } else {
    const item = document.querySelector<HTMLElement>(`.nav-item[data-room="${CSS.escape(room)}"]`);
    if (!item) throw new Error(`No page "${room}"`);
    item.click();
  }
  return settled();
}

let searches = 0;
/** Opens a sample title's page (by id or name) through the app's own search and title handlers, or plays it. */
async function openTitle(idOrName: string, play = false): Promise<boolean> {
  const meta = data.findTitle(idOrName);
  if (!meta) throw new Error(`No sample title "${idOrName}"`);
  const id = ++searches;
  await emit('remote://command', { kind: 'search', id, query: meta.name });
  const end = performance.now() + 5000;
  while (found?.id !== id && performance.now() < end) await wait(25);
  const index = found?.id === id ? found.results.findIndex((r) => r.name === meta.name) : -1;
  if (index < 0) throw new Error(`Search didn't find "${meta.name}"`);
  await emit('remote://command', { kind: 'open', search: id, index, play });
  return settled();
}

const send = (event: Record<string, unknown>) => emit('player://event', { load, ...event });
/** Playing an hour-long file, ten minutes in. */
const status = (extra = {}) =>
  send({ kind: 'status', timePos: 600, duration: 3600, paused: false, buffering: false, volume: 100, muted: false, cacheTime: 30, height: 1080, speed: 1, passthrough: false, eof: false, ...extra });

const helpers: AppTest = {
  data,
  settled,
  busy,
  go,
  openTitle: (idOrName) => openTitle(idOrName),
  /** Plays a title (a film by default) as Play on its page does, then (unless `start` is false) reports it loaded and playing. */
  openPlayer: async (idOrName = 'The Last Harbor', start = true) => {
    load = -1;
    await openTitle(idOrName, true);
    const end = performance.now() + 5000;
    while (load < 0 && performance.now() < end) await wait(25);
    if (load < 0) throw new Error('The player never opened');
    if (start) await window.orbitTest.start();
  },
  /** The file opens and plays, as mpv reports it. */
  start: async () => {
    await send({ kind: 'loaded' });
    await status();
    await send({ kind: 'ready' });
  },
  status,
  emit: (event, payload) => emit(event, payload),
  reconnect,
  player: (event) => send(event),
  settings: store,
  unanswered,
  calls,
  ready: (async () => {
    await settled();
    const room = params.get('room');
    if (room && room !== 'home') await go(room);
    const title = params.get('title');
    if (title) await openTitle(title);
    return settled();
  })(),
};
window.orbitTest = helpers as Window['orbitTest'];
