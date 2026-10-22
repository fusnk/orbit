import { describe, expect, it, vi } from 'vitest';
import { checklistItems, checklistVisible, closesAfterSaving, parseChecklist, playLeadsTo, shouldOnboard, welcomesNewcomer, type SetupSignals } from './rules';

describe('closesAfterSaving (Finish and Skip with keys typed)', () => {
  it('Finish closes once the keys are saved and stays open when one is not', async () => {
    expect(await closesAfterSaving(async () => true, false)).toBe(true);
    expect(await closesAfterSaving(async () => false, false)).toBe(false);
  });
  it('Skip saves what it can and closes anyway', async () => {
    const save = vi.fn(async () => false);
    expect(await closesAfterSaving(save, true)).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(await closesAfterSaving(() => Promise.reject(new Error('keychain')), true)).toBe(true);
  });
});

const fresh: SetupSignals = { done: false, ownAddons: 0, profiles: 1, history: 0, library: 0, tmdb: false, stremio: false };

describe('shouldOnboard', () => {
  it('shows on a new install', () => expect(shouldOnboard(fresh)).toBe(true));

  it('never again once finished or skipped', () => expect(shouldOnboard({ ...fresh, done: true })).toBe(false));

  it('never for an existing user, whatever they already have', () => {
    expect(shouldOnboard({ ...fresh, ownAddons: 1 })).toBe(false);
    expect(shouldOnboard({ ...fresh, profiles: 2 })).toBe(false);
    expect(shouldOnboard({ ...fresh, history: 3 })).toBe(false);
    expect(shouldOnboard({ ...fresh, library: 1 })).toBe(false);
    expect(shouldOnboard({ ...fresh, tmdb: true })).toBe(false);
    expect(shouldOnboard({ ...fresh, stremio: true })).toBe(false);
  });

  it('never when something could not be read', () => {
    for (const key of Object.keys(fresh) as (keyof SetupSignals)[]) {
      expect(shouldOnboard({ ...fresh, [key]: null })).toBe(false);
    }
  });

  it('a profile list that is empty still counts as new (the first profile is made at startup)', () => {
    expect(shouldOnboard({ ...fresh, profiles: 0 })).toBe(true);
  });
});

describe('Getting started card', () => {
  const nothing = { ownAddons: 0, history: 0, profiles: 1 };

  it('is not shown until a first-run setup started it', () => {
    const state = parseChecklist(undefined);
    expect(state).toBeNull();
    expect(checklistVisible(state, checklistItems({ dismissed: false, profilesSeen: false }, nothing))).toBe(false);
  });

  it('reads saved state defensively', () => {
    expect(parseChecklist({})).toEqual({ dismissed: false, profilesSeen: false });
    expect(parseChecklist({ dismissed: 'yes', profilesSeen: 1 })).toEqual({ dismissed: false, profilesSeen: false });
    expect(parseChecklist({ dismissed: true, profilesSeen: true })).toEqual({ dismissed: true, profilesSeen: true });
    expect(parseChecklist('open')).toBeNull();
  });

  it('ticks items off from what the profile has done', () => {
    const state = { dismissed: false, profilesSeen: false };
    expect(checklistItems(state, nothing).map((i) => i.done)).toEqual([false, false, false]);
    expect(checklistItems(state, { ownAddons: 1, history: 2, profiles: 2 }).map((i) => i.done)).toEqual([true, true, true]);
    expect(checklistItems({ ...state, profilesSeen: true }, nothing).find((i) => i.id === 'profiles')!.done).toBe(true);
  });

  it('Home welcomes a new install while the card is open and nothing has been watched', () => {
    const state = { dismissed: false, profilesSeen: false };
    expect(welcomesNewcomer(state, 0)).toBe(true);
    expect(welcomesNewcomer(state, 1)).toBe(false);
    expect(welcomesNewcomer({ ...state, dismissed: true }, 0)).toBe(false);
    // Never set up here (an existing user), or the card couldn't be read.
    expect(welcomesNewcomer(null, 0)).toBe(false);
  });

  it('"Play something" leads to adding an addon until one finds streams', () => {
    expect(playLeadsTo(0)).toBe('addons');
    expect(playLeadsTo(1)).toBe('movies');
  });

  it('shows while anything is left, and goes once dismissed or complete', () => {
    const state = { dismissed: false, profilesSeen: false };
    expect(checklistVisible(state, checklistItems(state, nothing))).toBe(true);
    expect(checklistVisible({ ...state, dismissed: true }, checklistItems(state, nothing))).toBe(false);
    expect(checklistVisible(state, checklistItems(state, { ownAddons: 1, history: 1, profiles: 3 }))).toBe(false);
  });
});
