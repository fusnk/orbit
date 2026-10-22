import { describe, expect, it, vi } from 'vitest';
import type { RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';

// Play pressed twice quickly (a double-click) on a movie stopped part-way, with a last source to offer.
const resumeChoice = vi.fn(() => new Promise<undefined>(() => {}));
vi.mock('./resume-choice', () => ({ resumeChoice }));
vi.mock('../../library/watch', () => ({ resumePosition: () => 600 }));
vi.mock('../../library/downloads', () => ({ blockReason: () => null, downloadBlock: () => null, downloadedCopy: () => undefined, downloadedSource: () => ({}) }));
vi.mock('../profiles/parental', () => ({ playAllowed: () => true }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../player/external', () => ({ alwaysExternal: () => false, canOpenExternally: () => false, externalConfigured: () => false, loadExternal: async () => {}, openExternally: async () => {} }));
vi.mock('../player', () => ({ openPlayer: vi.fn(), resumeAfterPrompt: vi.fn() }));
vi.mock('../../catalog/service', () => ({}));
vi.mock('../../components/drawer', () => ({}));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/state-message', () => ({}));
vi.mock('../../components/switch', () => ({}));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key, locale: () => 'en' }));
vi.mock('../../lib/dom', () => ({ h: () => ({}) }));
vi.mock('../../library/own-servers', () => ({}));
vi.mock('../../lib/autoplay', () => ({}));
vi.mock('../../lib/host-health', () => ({}));
vi.mock('../../lib/source-filter', () => ({}));
vi.mock('../../lib/ranking-fallback', () => ({}));
vi.mock('../../lib/stream-traits', () => ({}));
vi.mock('../../lib/torrent-files', () => ({}));
vi.mock('../player/file-picker', () => ({}));
vi.mock('../player/failed-sources', () => ({}));
vi.mock('../player/next-up', () => ({ PLAYBACK_SETTINGS: { play: 'play', resume: 'resume' } }));
vi.mock('../player/torrent', () => ({}));
vi.mock('../player/last-source', () => ({}));
vi.mock('../player/source-search', () => ({}));
vi.mock('../settings', () => ({}));
vi.mock('./ranking-prefs', () => ({}));
vi.mock('./streams.css', () => ({}));
vi.mock('../../live/vod', () => ({}));
vi.mock('./page-left', () => ({ pageLeft: () => () => false }));

const { playTitle } = await import('./streams');

const film: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

describe('Play pressed twice', () => {
  it('asks which source to resume with once, not twice', async () => {
    const ctx = {} as RoomContext;
    void playTitle(film, { ctx });
    void playTitle(film, { ctx });
    await vi.waitFor(() => expect(resumeChoice).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resumeChoice).toHaveBeenCalledOnce();
  });
});
