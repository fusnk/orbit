import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('./failed-sources', () => ({ failedRecently: () => () => false, loadFailures: async () => {}, markFailed: vi.fn(), markPlayed: vi.fn(), whereKey: (a: string, b = '') => `${a}/${b}` }));
vi.stubGlobal('window', globalThis);

import type { Title } from '../../catalog/titles';
import { createFailover } from './failover';
import type { PlayRequest } from './index';
import { mergeLateSources } from './late-sources';
import type { PlayableSource } from './panels';

const source = (id: string, addon: string, url: string): PlayableSource => ({ id, addon, url, label: '1080p', meta: '' }) as PlayableSource;
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

describe('failover after late sources', () => {
  it('never goes back to a source it tried, though the merge numbered it anew', () => {
    const a = source('n1', 'A', 'https://a/1');
    const b = source('n2', 'B', 'https://b/1');
    const request = { title: movie, source: a, sources: [a, b] } as unknown as PlayRequest;
    const failover = createFailover({
      enabled: () => true,
      request: () => request,
      position: () => undefined,
      switchTo: (next) => {
        request.source = next;
        failover.opening();
      },
    });
    failover.opening();
    expect(failover.recover('failed')).toBe(true);
    expect(request.source).toBe(b);
    // A slower addon answers: the full list comes in, A under a new id.
    request.sources = mergeLateSources(b, [a, b], [source('n1', 'A', 'https://a/1'), source('n2', 'B', 'https://b/1'), source('n3', 'C', 'https://c/1')]);
    expect(failover.recover('failed')).toBe(true);
    expect(request.source.addon).toBe('C');
    failover.stop();
  });
});
