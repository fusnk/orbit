import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { PlayRequest } from './index';
import type { PanelHost } from './panel-controller';
import type { TrackInfo } from './tracks';

/** Just enough of an element for the panel and its buttons (the views themselves are stubbed). */
class FakeEl extends EventTarget {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  title = '';
  textContent = '';
  scrollTop = 0;
  offsetWidth = 0;
  isConnected = true;
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    toggle: (name: string, on?: boolean) => void ((on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
  };
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    if (name === 'hidden') this.hidden = true;
    else if (name === 'class') value.split(' ').forEach((c) => this.classes.add(c));
    else this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  removeAttribute(name: string): void {
    delete this.attrs[name];
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
  remove(): void {}
  contains(other: unknown): boolean {
    for (let el = other instanceof FakeEl ? other : null; el; el = el.parent) if (el === this) return true;
    return false;
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
  closest(): null {
    return null;
  }
  focus(): void {}
  blur(): void {}
  click(): void {
    this.dispatchEvent(new Event('click'));
  }
}

/** The subtitles the addons offer for the title, as loadSubtitles answers. */
let offered: Promise<{ subtitles: unknown[]; failed: string[] }>;
const visible = { was: true };
const stores = new Map<string, { value: unknown }>();

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'player_set_subtitles_visible' ? visible.was : null)) }));
vi.mock('../../catalog/service', () => ({ loadSubtitles: vi.fn(() => offered) }));
vi.mock('../../components/icons', () => ({ icon: () => new FakeEl('svg') }));
vi.mock('../../components/text-field', () => ({ editingAt: () => null, resumeEditing: () => {} }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), tn: (key: string) => key, locale: () => 'en', language: () => 'en', isRtl: () => false }));
vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string | boolean> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== false) el.setAttribute(name, value === true ? '' : value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => undefined, set: async () => {} } }));
vi.mock('../../lib/platform', () => ({ isAndroid: false }));
vi.mock('../../lib/source-filter', () => ({ addonFilter: { resolve: () => null, choose: () => {} }, addonGroups: () => [] }));
vi.mock('../../library/queue', () => ({ dequeue: async () => {}, moveQueued: async () => {}, queueItems: () => [] }));
vi.mock('../detail/queue-actions', () => ({ playQueued: () => {} }));
vi.mock('../../library/watch', () => ({ onWatchChange: () => () => {} }));
vi.mock('../detail/streams', () => ({ playTitle: async () => {} }));
vi.mock('../../library/profiles', () => ({ profileSetting: async () => ({ key: null, value: null }) }));
vi.mock('./failed-sources', () => ({ failureOf: () => undefined, whereKey: (a: string, b = '') => `${a}/${b}` }));
vi.mock('./file-picker', () => ({ createFilePicker: () => new FakeEl('div'), focusFilePicker: () => {} }));
vi.mock('./hub', () => ({ hubFocusId: (kind: string) => `hub-${kind}`, hubView: () => [] }));
vi.mock('./layout', () => ({ DEFAULT_LAYOUT: {}, layoutChanged: () => {}, loadPlayerLayout: async () => ({}), PLAYER_LAYOUT_KEY: 'player.layout', watchPlayerLayout: () => () => {} }));
vi.mock('./panels', () => {
  const view = () => [];
  const names = new Proxy({}, { get: (_t, key) => String(key) });
  return {
    audioView: view, chaptersView: view, controlsSizeView: view, copyLinkView: view, episodesPanel: view, filesPanel: view, infoPanel: view, pictureView: view,
    queuePanel: view, sleepView: view, soundView: view, sourcePanel: view, speedView: view, subtitlesView: view, subtitleStyleView: view, timingView: view,
    formatDelay: String, MAX_SUBTITLE_BYTES: 1, PANEL_TITLES: names, QUALITY_NAMES: names, SLEEP_CHOICES: [],
  };
});
vi.mock('./keys', () => ({ withKey: (label: string) => label }));
vi.mock('./copy-link', () => ({ COPY_LINK_WARNED_PREFIX: 'copy', copyableLink: () => false, createCopyLink: () => ({ request: async () => {}, confirmed: async () => {} }) }));
vi.mock('./audio-device', () => ({ AUDIO_DEVICE_PREFIX: 'audio', AUTO_DEVICE: 'auto', deviceChoices: () => [], deviceMissing: () => false, listAudioDevices: async () => ({ devices: [] }), parseAudioDevice: () => 'auto' }));
// Esc with no search typed leaves the transcript (as transcript-view.ts does).
vi.mock('./transcript-view', () => ({ createTranscript: (host: { close(): void }) => ({ element: new FakeEl('div'), tick: () => {}, load: async () => {}, reset: () => {}, interacted: () => {}, escape: () => host.close(), dispose: () => {} }) }));
vi.mock('./torrent', () => ({ isTorrent: () => false, torrentFiles: async () => ({ files: [] }) }));
vi.mock('./playback-info', () => ({ createInfoPoller: () => ({ refresh: () => {}, reset: () => {}, dispose: () => {} }) }));
vi.mock('./paste-subtitles', () => ({ openPasteSubtitles: () => {} }));
vi.mock('./subtitle-sync', () => ({ createSubtitleSync: () => ({ tracks: () => {}, skip: () => {}, newFile: () => {}, setAuto: () => {}, state: () => ({ kind: 'idle' }), toggle: () => {}, note: () => null, available: () => false, dispose: () => {} }), stageText: () => '' }));
vi.mock('./subtitle-translate', () => ({ createSubtitleTranslate: () => ({ tracks: () => {}, newFile: () => {}, state: () => ({ kind: 'idle' }), toggle: () => {}, targetName: () => '', available: () => false, dispose: () => {} }), progressText: () => '' }));
// The per-title track memory, kept in memory instead of the profile's settings.
vi.mock('./profile-store', () => ({
  profileStore: <T,>(prefix: string, parse: (value: unknown) => T) => {
    const store = { value: parse(undefined) as unknown };
    stores.set(prefix, store);
    const update = async (change: (current: T) => T) => void (store.value = change(store.value as T));
    return { load: async () => {}, get: () => store.value as T, update, record: update };
  },
}));

const { invoke } = await import('@tauri-apps/api/core');
const { toast } = await import('../../components/toast');
const { createPanels } = await import('./panel-controller');
const { TRACK_MEMORY_PREFIX, trackMemory } = await import('./track-memory');

const movie = { id: 'tt7', type: 'movie', name: 'Film', genres: [], origins: [] } as unknown as Title;
const playing = { id: 's1', url: 'https://example.test/film.mkv', addon: 'Addon', label: '1080p', meta: '', filename: 'Film.2020.1080p.mkv' };

const track = (id: number, kind: 'audio' | 'sub', lang: string | null, more: Partial<TrackInfo> = {}): TrackInfo => ({
  id, kind, lang, title: null, codec: null, channels: null, selected: false, secondary: false, external: false, default: false, forced: false, ...more,
});
const offer = (lang: string, url = `https://subs.test/${lang}.srt`) => ({ item: { url, lang, subtitleFileName: `Film.${lang}.srt` }, origins: [{ name: 'Subs addon' }] });

function setup(options: { docked?: boolean; speed?: number; request?: Partial<PlayRequest> } = {}) {
  const sent: [string, Record<string, unknown>][] = [];
  const status = { timePos: 100 as number | null, duration: 6000, speed: options.speed ?? 1, passthrough: false, height: 1080 };
  const host = {
    ctx: {} as never,
    request: () => ({ title: movie, source: playing, sources: [playing], ...options.request }) as unknown as PlayRequest,
    status: () => ({ ...status }),
    sleep: { choice: () => 'off', note: () => '', pick: () => {} },
    load: vi.fn(),
    seekTo: vi.fn(),
    segments: () => [],
    playSegment: vi.fn(),
    soft: (cmd: string, args: Record<string, unknown>) => void sent.push([cmd, args]),
    showControls: vi.fn(),
    adjust: { newTitle: () => {}, delays: () => ({ sub: 0, audio: 0 }), setDelay: vi.fn(), sound: () => 'normal' },
    pictureQuality: () => 'auto',
    episodesDocked: () => options.docked ?? false,
    speedNote: () => '',
    toggleDock: vi.fn(),
    shortcuts: vi.fn(),
    volumeBoost: () => 100,
    setVolumeBoost: vi.fn(),
  } as unknown as PanelHost;
  const panels = createPanels(host);
  /** What was sent to mpv with `cmd`, oldest first. */
  const calls = (cmd: string) => sent.filter(([c]) => c === cmd).map(([, args]) => args);
  return { panels, host, status, calls, sent };
}

/** The file starts with `tracks` (mpv lists them, then shows the first frame), once the title's offers and memory are in. */
async function start(panels: ReturnType<typeof createPanels>, tracks: TrackInfo[]) {
  panels.newTitle();
  await vi.advanceTimersByTimeAsync(0);
  panels.setTracks(tracks);
  panels.started();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { activeElement: null, body: new FakeEl('body') });
  vi.stubGlobal('HTMLElement', FakeEl);
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  offered = Promise.resolve({ subtitles: [], failed: [] });
  visible.was = true;
  const memory = stores.get(TRACK_MEMORY_PREFIX);
  if (memory) memory.value = [];
  vi.mocked(invoke).mockClear();
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the panel’s views', () => {
  it('opens a view from its button, and closes it from the same button', () => {
    const { panels } = setup();
    const element = panels.element as unknown as FakeEl;
    const speed = panels.buttons.speed as unknown as FakeEl;
    expect(element.hidden).toBe(true);
    speed.click();
    expect(panels.kind()).toBe('speed');
    expect(element.hidden).toBe(false);
    expect(speed.getAttribute('aria-expanded')).toBe('true');
    speed.click();
    expect(panels.kind()).toBeNull();
    expect(element.hidden).toBe(true);
    expect(speed.getAttribute('aria-expanded')).toBe('false');
  });

  it('stacks a view opened from the hub; Back goes up one level, then closes', () => {
    const { panels } = setup();
    panels.toggle('hub');
    panels.open('audio');
    expect(panels.kind()).toBe('audio');
    panels.back();
    expect(panels.kind()).toBe('hub');
    panels.back();
    expect(panels.kind()).toBeNull();
  });

  it('goes back to the hub from a transcript opened there with Esc, and closes one opened alone', () => {
    const { panels } = setup();
    panels.toggle('hub');
    panels.open('transcript');
    panels.keyBack();
    expect(panels.kind()).toBe('hub');
    panels.close();
    panels.toggle('transcript');
    panels.keyBack();
    expect(panels.kind()).toBeNull();
  });

  it('switches to another view from its button rather than stacking it', () => {
    const { panels } = setup();
    panels.toggle('hub');
    panels.open('audio');
    panels.toggle('speed');
    expect(panels.kind()).toBe('speed');
    panels.back();
    expect(panels.kind()).toBeNull();
  });

  it('works the docked episode list from the Episodes button', () => {
    const { panels, host } = setup({ docked: true });
    panels.toggle('hub');
    panels.toggle('episodes');
    expect(panels.kind()).toBeNull();
    expect(host.toggleDock).toHaveBeenCalledOnce();
  });

  it('marks the speed button while the speed isn’t normal', () => {
    const { panels, status } = setup({ speed: 1.5 });
    const speed = panels.buttons.speed as unknown as FakeEl;
    panels.render();
    expect(speed.classes.has('active')).toBe(true);
    status.speed = 1;
    panels.render();
    expect(speed.classes.has('active')).toBe(false);
  });
});

describe('subtitles picked by themselves', () => {
  it('loads an addon’s subtitle in the preferred language when the file has none', async () => {
    offered = Promise.resolve({ subtitles: [offer('en'), offer('fr')], failed: [] });
    const { panels, calls } = setup();
    panels.preferSubtitles(['fr'], false);
    await start(panels, [track(1, 'audio', 'en', { selected: true }), track(2, 'sub', 'en')]);
    expect(calls('player_add_subtitle')).toEqual([{ url: 'https://subs.test/fr.srt', title: 'Subs addon · French 1', lang: 'fr' }]);
  });

  it('loads nothing when the file has a subtitle in that language', async () => {
    offered = Promise.resolve({ subtitles: [offer('fr')], failed: [] });
    const { panels, calls } = setup();
    panels.preferSubtitles(['fr'], false);
    await start(panels, [track(1, 'audio', 'en', { selected: true }), track(2, 'sub', 'fr')]);
    expect(calls('player_add_subtitle')).toEqual([]);
  });

  it('waits for the addons’ offers when the file starts first, then loads once', async () => {
    let answer!: (found: { subtitles: unknown[]; failed: string[] }) => void;
    offered = new Promise((resolve) => (answer = resolve));
    const { panels, calls } = setup();
    panels.preferSubtitles(['fr'], false);
    await start(panels, [track(1, 'audio', 'en', { selected: true })]);
    expect(calls('player_add_subtitle')).toEqual([]);
    answer({ subtitles: [offer('fr')], failed: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('player_add_subtitle')).toHaveLength(1);
    // mpv lists the added subtitle, and the file reports started again: not loaded a second time.
    panels.setTracks([track(1, 'audio', 'en', { selected: true }), track(3, 'sub', 'fr', { selected: true, external: true })]);
    panels.started();
    expect(calls('player_add_subtitle')).toHaveLength(1);
  });

  it('picks again for another source of the same title', async () => {
    offered = Promise.resolve({ subtitles: [offer('fr')], failed: [] });
    const { panels, calls } = setup();
    panels.preferSubtitles(['fr'], false);
    await start(panels, [track(1, 'audio', 'en', { selected: true })]);
    panels.newFile();
    panels.setTracks([track(1, 'audio', 'en', { selected: true })]);
    panels.started();
    expect(calls('player_add_subtitle')).toHaveLength(2);
  });

  it('asks the addons again for another source of the same title, with its own subtitles', async () => {
    const { loadSubtitles } = await import('../../catalog/service');
    offered = Promise.resolve({ subtitles: [offer('fr', 'https://a.test/fr.srt')], failed: [] });
    let source: Record<string, unknown> = { ...playing, subtitles: [{ url: 'https://a.test/fr.srt', lang: 'fr' }] };
    const { panels, calls } = setup({ request: { get source() { return source; } } as unknown as Partial<PlayRequest> });
    panels.preferSubtitles(['fr'], false);
    await start(panels, [track(1, 'audio', 'en', { selected: true })]);
    vi.mocked(loadSubtitles).mockClear();
    // A failover to another addon's file: the first one's subtitle is cut for another release.
    offered = Promise.resolve({ subtitles: [offer('fr', 'https://b.test/fr.srt')], failed: [] });
    source = { ...playing, id: 's2', url: 'https://example.test/other.mkv', filename: 'Film.2020.720p.mkv', subtitles: [{ url: 'https://b.test/fr.srt', lang: 'fr' }] };
    panels.newFile();
    expect(loadSubtitles).toHaveBeenCalledOnce();
    expect(vi.mocked(loadSubtitles).mock.calls[0]?.[2]).toEqual({ filename: 'Film.2020.720p.mkv', videoSize: undefined, videoHash: undefined });
    await vi.advanceTimersByTimeAsync(0);
    panels.setTracks([track(1, 'audio', 'en', { selected: true })]);
    panels.started();
    expect(calls('player_add_subtitle').map((c) => c.url)).toEqual(['https://a.test/fr.srt', 'https://b.test/fr.srt']);
  });

  it('asks the addons once when the player moves to another title', async () => {
    const { loadSubtitles } = await import('../../catalog/service');
    let title: Title = movie;
    const { panels } = setup({ request: { get title() { return title; } } as unknown as Partial<PlayRequest> });
    await start(panels, []);
    vi.mocked(loadSubtitles).mockClear();
    title = { ...movie, id: 'tt8' };
    panels.newFile();
    panels.newTitle();
    expect(loadSubtitles).toHaveBeenCalledOnce();
  });

  it('asks no addon for a live channel', async () => {
    const { loadSubtitles } = await import('../../catalog/service');
    vi.mocked(loadSubtitles).mockClear();
    const { panels } = setup({ request: { live: true } as Partial<PlayRequest> });
    panels.newTitle();
    expect(loadSubtitles).not.toHaveBeenCalled();
  });

  it('turns subtitles off on a title they were turned off for by hand', async () => {
    const { panels, calls } = setup();
    trackMemory.remember('tt7', 'sub', 'off');
    await start(panels, [track(1, 'audio', 'en', { selected: true }), track(2, 'sub', 'en', { selected: true })]);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: null }]);
  });

  it('switches to the language picked by hand for this title', async () => {
    const { panels, calls } = setup();
    trackMemory.remember('tt7', 'sub', 'de');
    await start(panels, [track(1, 'audio', 'en', { selected: true }), track(2, 'sub', 'en', { selected: true }), track(3, 'sub', 'de')]);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: 3 }]);
  });

  it('avoids a commentary track mpv picked by its flags', async () => {
    const { panels, calls } = setup();
    panels.avoidTracks(['commentary']);
    await start(panels, [track(1, 'audio', 'en', { selected: true, title: 'Director’s Commentary' }), track(2, 'audio', 'en')]);
    expect(calls('player_select_track')).toEqual([{ kind: 'audio', id: 2 }]);
  });
});

describe('subtitles picked by hand', () => {
  it('turns subtitles off, and remembers that for the title', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en', { selected: true })]);
    panels.chooseSubtitleTrack(null);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: null }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(trackMemory.get('tt7').sub).toBe('off');
  });

  it('ignores a track the file doesn’t have', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en')]);
    panels.chooseSubtitleTrack(9);
    expect(calls('player_select_track')).toEqual([]);
  });

  it('says which languages are playing', async () => {
    const { panels } = setup();
    await start(panels, [track(1, 'audio', 'ja', { selected: true }), track(2, 'sub', 'en', { selected: true })]);
    expect(panels.selectedLanguages()).toEqual({ audio: 'ja', subtitle: 'en' });
    expect(panels.subtitleSelected()).toBe(true);
  });
});

describe('the Subtitles key with none on', () => {
  it('shows the preferred language’s track', async () => {
    const { panels, calls } = setup();
    panels.preferSubtitles(['de'], false);
    await start(panels, [track(2, 'sub', 'en'), track(3, 'sub', 'de')]);
    expect(panels.showSomeSubtitle()).toBe(true);
    expect(calls('player_select_track').at(-1)).toEqual({ kind: 'sub', id: 3 });
  });

  it('loads an addon’s in that language when the file has none', async () => {
    offered = Promise.resolve({ subtitles: [offer('de')], failed: [] });
    const { panels, calls } = setup();
    // Not picked by itself: the person has turned it off.
    trackMemory.remember('tt7', 'sub', 'off');
    panels.preferSubtitles(['de'], false);
    await start(panels, [track(2, 'sub', 'it')]);
    expect(calls('player_add_subtitle')).toEqual([]);
    expect(panels.showSomeSubtitle()).toBe(true);
    expect(calls('player_add_subtitle')).toEqual([{ url: 'https://subs.test/de.srt', title: 'Subs addon · German 1', lang: 'de' }]);
  });

  it('falls back to the file’s first, and says false with nothing to show', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(4, 'sub', 'it'), track(5, 'sub', 'pt')]);
    expect(panels.showSomeSubtitle()).toBe(true);
    expect(calls('player_select_track').at(-1)).toEqual({ kind: 'sub', id: 4 });
    const empty = setup();
    await start(empty.panels, []);
    expect(empty.panels.showSomeSubtitle()).toBe(false);
  });
});

describe('“What did they say?”', () => {
  it('goes back 10 seconds with subtitles on, and turns them off once playback catches up', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(1, 'audio', 'en', { selected: true }), track(2, 'sub', 'en')]);
    panels.whatDidTheySay();
    expect(calls('player_seek')).toEqual([{ seconds: -10, relative: true }]);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: 2 }]);
    // mpv reports the replay: still before where it was asked.
    panels.tick(95);
    expect(calls('player_select_track')).toHaveLength(1);
    panels.tick(100);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: 2 }, { kind: 'sub', id: null }]);
    panels.tick(120);
    expect(calls('player_select_track')).toHaveLength(2);
  });

  it('hides a subtitle that was hidden with the Subtitles key again, rather than turning it off', async () => {
    visible.was = false;
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en', { selected: true })]);
    panels.whatDidTheySay();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledWith('player_set_subtitles_visible', { visible: true });
    panels.tick(100);
    expect(calls('player_set_subtitles_visible')).toEqual([{ visible: false }]);
    expect(calls('player_select_track')).toEqual([]);
  });

  it('leaves subtitles that were showing alone', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en', { selected: true })]);
    panels.whatDidTheySay();
    await vi.advanceTimersByTimeAsync(0);
    panels.tick(100);
    expect(calls('player_set_subtitles_visible')).toEqual([]);
    expect(calls('player_select_track')).toEqual([]);
  });

  it('keeps a subtitle picked during the replay', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en'), track(3, 'sub', 'de')]);
    panels.whatDidTheySay();
    panels.chooseSubtitleTrack(3);
    panels.tick(100);
    expect(calls('player_select_track').at(-1)).toEqual({ kind: 'sub', id: 3 });
  });

  it('says so when the file has no subtitles', async () => {
    const { panels } = setup();
    await start(panels, [track(1, 'audio', 'en', { selected: true })]);
    panels.whatDidTheySay();
    expect(toast).toHaveBeenCalledWith('player.tracks.none-to-show');
  });

  it('stops waiting to turn them off when another file loads', async () => {
    const { panels, calls } = setup();
    await start(panels, [track(2, 'sub', 'en')]);
    panels.whatDidTheySay();
    panels.newFile();
    panels.tick(100);
    expect(calls('player_select_track')).toEqual([{ kind: 'sub', id: 2 }]);
  });
});
