/**
 * The real player, opened in a plain browser for the layout tests (player.spec.ts).
 * Rust is faked: every command answers null except the settings the page asks for,
 * and `window.orbitTest.status()` sends the player events mpv would.
 * `?layout=cinema` picks the Settings → Player preset.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { PlayerTest } from './orbit-test';

const preset = new URLSearchParams(location.search).get('layout') ?? 'orbit';
const background = new URLSearchParams(location.search).get('bg') ?? 'gradient';
/** `?theme=glass`: the app theme (its CSS and tokens), as Settings → Looks sets it. */
const theme = new URLSearchParams(location.search).get('theme');
const settingValues: Record<string, unknown> = { 'player.layout': { preset, background }, ...(theme ? { theme } : {}) };
/** Commands whose answer isn't null. */
const answers: Record<string, unknown> = {
  addon_list: [],
  skip_segments: [],
  aniskip_segments: [],
  profile_list: [{ id: 'main', name: 'Me', color: '#e5484d', avatar: null, addonsFrom: null, hasPin: false, contentLimit: { level: 'off', allowUnrated: true, allowLiveTv: true } }],
};

/** The player numbers each file it opens (`load`); events for another number are ignored. */
let load = 0;

mockWindows('main');
mockIPC((cmd, args) => {
  if (cmd === 'player_open') load = (args as { load: number }).load;
  if (cmd === 'settings_get') return settingValues[(args as { key: string }).key] ?? null;
  return answers[cmd] ?? null;
}, { shouldMockEvents: true });

await import('@fontsource-variable/manrope');
await import('../../src/theme/tokens.css');
await import('../../src/styles.css');
if (theme) await (await import('../../src/theme/engine')).loadTheme();
const { openPlayer } = await import('../../src/rooms/player');
const { PRESETS } = await import('../../src/rooms/player/layout');

const source = { id: 's1', url: 'https://example.invalid/video.mkv', addon: 'Test addon', label: '1080p', meta: 'x265 · 2.1 GB' };
openPlayer(
  { title: { id: 'tt0000001', type: 'movie', name: 'Layout Test', genres: [], origins: [] }, source, sources: [source] },
  { open: (view) => document.body.replaceChildren(view), back: () => {}, go: () => {} },
);

const send = (event: Record<string, unknown>) => emit('player://event', { load, ...event });
// Playing an hour-long file, ten minutes in.
const status = (extra = {}) =>
  send({ kind: 'status', timePos: 600, duration: 3600, paused: false, buffering: false, volume: 100, muted: false, cacheTime: 30, height: 1080, speed: 1, passthrough: false, eof: false, ...extra });
const helpers: PlayerTest = {
  presets: PRESETS,
  /** The file opens and plays, as mpv reports it. */
  start: async () => {
    await send({ kind: 'loaded' });
    await status();
    await send({ kind: 'ready' });
  },
  status,
};
window.orbitTest = helpers as Window['orbitTest'];
