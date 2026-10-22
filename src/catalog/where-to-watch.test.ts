import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), region: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./streaming', () => ({ streamingRegion: mocks.region }));
import { badgeProviders, titleTopics } from './title-topics';
const netflix = { id: 8, name: 'Netflix', logo: 'https://image.tmdb.org/t/p/w92/netflix.jpg' };
const disney = { id: 337, name: 'Disney+', logo: 'https://image.tmdb.org/t/p/w92/disney.jpg' };
const topics = { keywords: [], providers: { stream: [netflix, disney], rent: [], buy: [] } };
beforeEach(() => { mocks.invoke.mockReset(); mocks.region.mockResolvedValue('US'); });
describe('where to watch badges', () => {
  it('keeps at most two streaming logos, deduplicating and skipping unknown logos', () => {
    expect(badgeProviders({ ...topics, providers: { ...topics.providers, stream: [netflix, netflix, { ...disney, logo: '' }, disney, { ...netflix, id: 9 }] } })).toEqual([netflix, disney]);
  });
  it('shows one badge per brand (Apple TV and Apple TV+, Netflix with ads)', () => {
    const appleTv = { id: 2, name: 'Apple TV', logo: 'https://image.tmdb.org/t/p/w92/a.jpg' };
    const appleTvPlus = { id: 350, name: 'Apple TV+', logo: 'https://image.tmdb.org/t/p/w92/b.jpg' };
    const netflixAds = { id: 1796, name: 'Netflix Standard with Ads', logo: 'https://image.tmdb.org/t/p/w92/c.jpg' };
    expect(badgeProviders({ ...topics, providers: { ...topics.providers, stream: [appleTvPlus, appleTv, netflixAds, netflix] } })).toEqual([appleTvPlus, netflixAds]);
  });
  it('never calls rentals streaming or invents a provider when unknown', () => {
    expect(badgeProviders(null)).toEqual([]);
    expect(badgeProviders({ ...topics, providers: { stream: [], rent: [netflix], buy: [disney] } })).toEqual([]);
  });
  it('shares a lookup but isolates region and title kind', async () => {
    mocks.invoke.mockResolvedValue(topics);
    const title = { id: 'tt123456789', type: 'movie' } as const;
    await Promise.all([titleTopics(title), titleTopics(title)]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    mocks.region.mockResolvedValue('FR');
    await titleTopics(title);
    await titleTopics({ ...title, type: 'series' });
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenLastCalledWith('tmdb_title_topics', { imdbId: title.id, kind: 'series', region: 'FR' });
  });
  it('skips off-origin and malformed logo paths without hiding valid services', () => {
    const bad = ['https://evil.example/logo.jpg', 'https://image.tmdb.org.evil.example/t/p/w92/a.jpg', 'https://image.tmdb.org/t/p/w92/../a.jpg', 'https://image.tmdb.org/t/p/w92/a.jpg?token=private'];
    expect(badgeProviders({ ...topics, providers: { ...topics.providers, stream: [...bad.map((logo, i) => ({ ...netflix, id: 10 + i, logo })), disney] } })).toEqual([disney]);
  });
  it('retries unavailable and failed lookups instead of caching failure', async () => {
    const title = { id: 'tt987654321', type: 'movie' } as const;
    mocks.invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(topics);
    expect(await titleTopics(title)).toBeNull();
    await expect(titleTopics(title)).rejects.toThrow('unavailable');
    expect(await titleTopics(title)).toEqual(topics);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
  it('does not look up unsupported identifiers or title types', async () => {
    expect(await titleTopics({ id: 'kitsu:1234', type: 'series' })).toBeNull();
    expect(await titleTopics({ id: 'tt100', type: 'channel' })).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});