import { describe, expect, it } from 'vitest';
import { parseRelease } from './subtitle-match';
import { autoSubtitle, nextOffer, rankOffers, titleOffers, type TrackInfo } from './tracks';

const track = (over: Partial<TrackInfo>): TrackInfo => ({
  id: 1,
  kind: 'sub',
  title: null,
  lang: null,
  codec: null,
  channels: null,
  selected: false,
  secondary: false,
  external: true,
  default: false,
  forced: false,
  ...over,
});

const video = parseRelease('Show.S01E02.1080p.WEB-DL.x264-GRP.mkv');
const offers = titleOffers([
  { url: 'https://a/1', lang: 'eng', addon: 'OS', release: { name: 'Show.S01E02.720p.HDTV.x264-OTHER.srt' } },
  { url: 'https://a/2', lang: 'eng', addon: 'OS', release: { name: 'Show.S01E02.1080p.WEB-DL.x264-GRP.srt' } },
  { url: 'https://a/3', lang: 'spa', addon: 'OS' },
  { url: 'https://b/1', lang: 'en', addon: 'Subs', release: { name: 'Show.S01E02.WEBRip.srt' } },
]);

describe('rankOffers', () => {
  it('puts the best match for the release first, the same pick as autoSubtitle', () => {
    const ranked = rankOffers(offers, 'en', video).map((o) => o.url);
    expect(ranked).toEqual(['https://a/2', 'https://b/1', 'https://a/1']);
    expect(autoSubtitle([], offers, 'en', 'en', video)?.url).toBe(ranked[0]);
  });

  it('keeps the addons’ order with nothing known about the release', () => {
    expect(rankOffers(offers, 'en').map((o) => o.url)).toEqual(['https://a/1', 'https://a/2', 'https://b/1']);
  });
});

describe('nextOffer', () => {
  const ranked = rankOffers(offers, 'en', video);

  it('goes from the showing offer to the next best, then cycles', () => {
    const showing = (offer: (typeof ranked)[number]) => [track({ id: 5, title: offer.title, selected: true, lang: 'en' })];
    expect(nextOffer(showing(ranked[0]!), offers, 'en', video)).toMatchObject({ offer: ranked[1], position: 2, total: 3, lang: 'en' });
    expect(nextOffer(showing(ranked[1]!), offers, 'en', video)).toMatchObject({ offer: ranked[2], position: 3 });
    expect(nextOffer(showing(ranked[2]!), offers, 'en', video)).toMatchObject({ offer: ranked[0], position: 1 });
  });

  it('selects an offer added before instead of adding it again', () => {
    const tracks = [track({ id: 5, title: ranked[0]!.title, selected: true }), track({ id: 6, title: ranked[1]!.title })];
    expect(nextOffer(tracks, offers, 'en', video)?.track?.id).toBe(6);
  });

  it('follows an offer just asked for that mpv hasn’t listed yet', () => {
    expect(nextOffer([], offers, 'en', video, ranked[1]!.title)?.offer).toBe(ranked[2]);
  });

  it('starts with the best when the file’s own subtitle (or none) is on', () => {
    expect(nextOffer([track({ external: false, lang: 'eng', selected: true })], offers, 'fr', video)?.offer).toBe(ranked[0]);
    expect(nextOffer([], offers, 'en', video)?.offer).toBe(ranked[0]);
  });

  it('has nothing to switch to with one offer showing, or none in the language', () => {
    const spanish = offers.find((o) => o.lang === 'spa')!;
    expect(nextOffer([track({ title: spanish.title, selected: true })], offers, 'en', video)).toBeUndefined();
    expect(nextOffer([], offers, 'de', video)).toBeUndefined();
    expect(nextOffer([], offers, '', video)).toBeUndefined();
  });
});
