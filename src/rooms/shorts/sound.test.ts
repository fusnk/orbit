import { expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>([['shorts.sound.kid', true]]));
const profile = vi.hoisted(() => ({ id: 'kid' }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: unknown) => void store.set(key, value) } }));
vi.mock('../../library/profiles', () => ({ profileSetting: async (prefix: string) => ({ key: `${prefix}.${profile.id}`, value: store.get(`${prefix}.${profile.id}`) ?? null }) }));

const { loadShortsSound, saveShortsSound } = await import('./sound');

it('remembers the Shorts sound per profile', async () => {
  expect(await loadShortsSound()).toBe(true);
  profile.id = 'adult';
  expect(await loadShortsSound()).toBe(false);
  await saveShortsSound(true);
  profile.id = 'kid';
  await saveShortsSound(false);
  expect(store.get('shorts.sound.adult')).toBe(true);
  expect(store.get('shorts.sound.kid')).toBe(false);
  expect(store.has('shorts.sound')).toBe(false);
});
