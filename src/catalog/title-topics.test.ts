import { describe, expect, it } from 'vitest';
import { onlyInCinemas, parseTopics } from './title-topics';

describe('title topics', () => {
  it('reads topics and providers, refusing anything off TMDB', () => {
    const raw = {
      keywords: [
        { id: 310, name: 'artificial intelligence (a.i.)' },
        { id: 4565, name: 'dystopia' },
      ],
      providers: {
        stream: [{ id: 8, name: 'Netflix', logo: 'https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' }],
        rent: [],
        buy: [],
      },
    };
    expect(parseTopics(raw)?.keywords.map((k) => k.name)).toEqual(['artificial intelligence (a.i.)', 'dystopia']);
    expect(parseTopics({ ...raw, providers: { ...raw.providers, rent: [{ id: 2, name: 'Apple TV', logo: 'https://evil.example/x.png' }] } })).toBeNull();
    expect(parseTopics({ ...raw, keywords: [{ id: 0, name: 'zero' }] })).toBeNull();
    expect(parseTopics(null)).toBeNull();
  });

  it('knows when a film is only in cinemas so far', () => {
    const cinema = { kind: 'cinema', date: '2026-09-20' } as const;
    expect(onlyInCinemas([cinema], '2026-10-05')).toBe(true);
    // Digital coming later still counts as cinemas only.
    expect(onlyInCinemas([cinema, { kind: 'digital', date: '2026-11-10' }], '2026-10-05')).toBe(true);
    expect(onlyInCinemas([cinema, { kind: 'digital', date: '2026-10-01' }], '2026-10-05')).toBe(false);
    // Not out yet, or no dates at all.
    expect(onlyInCinemas([{ kind: 'cinema', date: '2026-12-01' }], '2026-10-05')).toBe(false);
    expect(onlyInCinemas([], '2026-10-05')).toBe(false);
  });
});
