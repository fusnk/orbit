import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoked: [string, Record<string, unknown>][] = [];
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string, args: Record<string, unknown>) => void invoked.push([cmd, args]) }));
// The profile's content limit: ids starting "blocked" are over it; "late" ones go over it after the rows were drawn.
const allowedTitles = vi.fn(async (titles: { id: string }[]) => titles.filter((title) => !title.id.startsWith('blocked')));
vi.mock('../catalog/parental', () => ({
  allowedTitles: (titles: { id: string }[]) => allowedTitles(titles),
  verdictFor: async (title: { id: string }) => (title.id.startsWith('blocked') || title.id.startsWith('late') ? 'blocked' : 'allowed'),
}));
vi.mock('../catalog/service', () => ({ usableAddons: async () => [], loadMeta: async () => null }));
vi.mock('../catalog/tmdb', () => ({ tmdbConnected: async () => false }));
vi.mock('../catalog/titles', () => ({ browsableCatalogs: () => [], displayYear: (year?: string) => year, runtimeLabel: (runtime?: string) => runtime }));
const toast = vi.fn();
vi.mock('../components/toast', () => ({ toast: (message: string) => toast(message) }));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
const toggleLibrary = vi.fn(async (title: unknown) => !!title);
vi.mock('../library/library', () => ({ inLibrary: () => false, toggleLibrary: (title: unknown) => toggleLibrary(title) }));
vi.mock('../rooms/discover/surprise', () => ({ quickSurprise: async () => ({ pick: film('surprise-1'), failed: false }) }));
vi.mock('../rooms/home/chip-rows', () => ({
  moodChips: async () => ({ region: '', chips: [{ chip: 'scare', label: 'Scare', load: async () => [film('scary'), film('blocked-gore')] }] }),
}));
// Off for a test of Home not having drawn yet.
let feedsKnown = true;
vi.mock('../rooms/home/feeds', () => ({
  HOME_FEEDS_KNOWN: 'home-feeds-known',
  homeFeeds: () => (feedsKnown ? feedsLoader : null),
}));
const feedsLoader = async () => [
    { title: 'Continue Watching', load: async () => [film('blocked-1'), film('kept-1'), film('late-1')] },
    { title: 'Only blocked', load: async () => [film('blocked-2')] },
    { title: 'Popular', load: async () => [film('kept-2')] },
];

function film(id: string) {
  return { id, type: 'movie', name: id, year: '2020', rating: '7.1', poster: `https://img.example/${id}.jpg`, genres: [], origins: [] };
}

// The picker keeps what it last sent the phone (shelves, mood chips), so each test gets a fresh copy of it and
// asks for Home itself when it needs it: no test leans on another having run first.
let runPicker: typeof import('./remote-picker').runPicker;

const sent = (cmd: string) => invoked.filter(([name]) => name === cmd).map(([, args]) => args);
const names = (titles: unknown) => (titles as { name: string }[]).map((title) => title.name);
const play = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  ({ runPicker } = await import('./remote-picker'));
  invoked.length = 0;
  play.mockClear();
  toast.mockClear();
  toggleLibrary.mockClear();
});

/** Home as the phone saw it: answer 1, whose rows are Continue Watching (kept-1, late-1) and Popular (kept-2). */
const browseHome = () => runPicker({ kind: 'browse', id: 1 }, play);

describe('phone remote picker and the content limit', () => {
  it('Home’s rows keep only allowed titles, and rows left empty are dropped', async () => {
    await browseHome();
    const [home] = sent('remote_picker_home');
    const rows = home!.rows as { title: string; titles: unknown }[];
    expect(rows.map((row) => row.title)).toEqual(['Continue Watching', 'Popular']);
    expect(names(rows[0]!.titles)).toEqual(['kept-1', 'late-1']);
    expect(home!.moods).toEqual([{ id: 'scare', label: 'Scare' }]);
    // The poster's address goes to Rust (which never hands it to the phone).
    expect(rows[1]!.titles).toEqual([{ name: 'kept-2', year: '2020', kind: 'movie', rating: '7.1', poster: 'https://img.example/kept-2.jpg' }]);
  });

  it('a mood’s picks pass the same filter', async () => {
    await browseHome();
    await runPicker({ kind: 'mood', id: 2, mood: 'scare' }, play);
    const [mood] = sent('remote_picker_titles');
    expect(mood).toMatchObject({ shelf: 'mood', id: 2, failed: false });
    expect(names(mood!.titles)).toEqual(['scary']);
  });

  it('plays a title by its place in the answer the phone saw', async () => {
    await browseHome();
    await runPicker({ kind: 'pick', from: 'home', shelf: 1, row: 1, index: 0, action: 'play' }, play);
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ id: 'kept-2' }));
  });

  it('checks the limit again before playing or adding', async () => {
    await browseHome();
    await runPicker({ kind: 'pick', from: 'home', shelf: 1, row: 0, index: 1, action: 'play' }, play);
    await runPicker({ kind: 'pick', from: 'home', shelf: 1, row: 0, index: 1, action: 'add' }, play);
    expect(play).not.toHaveBeenCalled();
    expect(toggleLibrary).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('parental.blocked.toast');
  });

  it('ignores a place in an older or unknown answer', async () => {
    await browseHome();
    await runPicker({ kind: 'pick', from: 'home', shelf: 0, row: 0, index: 0, action: 'play' }, play);
    await runPicker({ kind: 'pick', from: 'home', shelf: 1, row: 5, index: 0, action: 'play' }, play);
    expect(play).not.toHaveBeenCalled();
  });

  it('adds to the library, and sends the details again', async () => {
    await browseHome();
    await runPicker({ kind: 'details', id: 3, from: 'home', shelf: 1, row: 0, index: 0 }, play);
    expect(sent('remote_picker_details')[0]).toMatchObject({ id: 3, failed: false, details: { name: 'kept-1', inLibrary: false } });
    await runPicker({ kind: 'pick', from: 'home', shelf: 1, row: 0, index: 0, action: 'add' }, play);
    expect(toggleLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: 'kept-1' }));
    expect(sent('remote_picker_details')).toHaveLength(2);
  });

  it('a surprise is one title', async () => {
    await runPicker({ kind: 'surprise', id: 4, media: 'movie' }, play);
    expect(sent('remote_picker_titles')[0]).toMatchObject({ shelf: 'surprise', id: 4, titles: [{ name: 'surprise-1' }] });
  });
});

describe('phone remote picker before Home has drawn', () => {
  it('stops listening for Home once it gives up waiting', async () => {
    const listeners = new Set<unknown>();
    vi.stubGlobal('document', {
      addEventListener: (_type: string, listener: unknown, options?: { signal?: AbortSignal }) => {
        listeners.add(listener);
        options?.signal?.addEventListener('abort', () => listeners.delete(listener));
      },
      removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener),
    });
    vi.useFakeTimers();
    feedsKnown = false;
    try {
      const done = runPicker({ kind: 'browse', id: 50 }, play);
      await vi.advanceTimersByTimeAsync(8000);
      await done;
      expect(sent('remote_picker_home')[0]!.rows).toEqual([]);
      expect(listeners.size).toBe(0);
    } finally {
      feedsKnown = true;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
