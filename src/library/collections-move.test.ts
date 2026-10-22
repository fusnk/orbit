import { describe, expect, it, vi } from 'vitest';

const ids = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', 'dddddddddddddddd'];
let order = [...ids];
const row = (id: string) => ({ id, name: id.slice(0, 1), art: {}, sources: [], createdAt: 0, items: [] });

// A slow store, like a round trip to Rust.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: { id: string; to: number }) =>
    new Promise((resolve) =>
      setTimeout(() => {
        if (cmd === 'collection_move') {
          order = order.filter((id) => id !== args.id);
          order.splice(args.to, 0, args.id);
        }
        resolve(cmd === 'collection_all' ? order.map(row) : undefined);
      }, 5),
    ),
}));

import { customCollections, loadCollections, shiftCollection } from './collections';

describe('moving a collection', () => {
  it('moves from where it is when the move runs, so two quick presses move it twice', async () => {
    await loadCollections();
    await Promise.all([shiftCollection(ids[0]!, 1), shiftCollection(ids[0]!, 1)]);
    expect(customCollections().map((c) => c.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  });
});
