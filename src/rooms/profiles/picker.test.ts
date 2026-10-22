import { beforeEach, describe, expect, it, vi } from 'vitest';

const listProfiles = vi.fn();
const activeProfileId = vi.fn();
vi.mock('../../library/profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../library/profiles')>()),
  listProfiles: () => listProfiles(),
  activeProfileId: () => activeProfileId(),
}));

const { openProfileSwitcher } = await import('./picker');

describe('profile switcher', () => {
  beforeEach(() => {
    listProfiles.mockReset();
    activeProfileId.mockReset().mockResolvedValue(null);
  });

  it('opens once when pressed again while the profiles load', () => {
    // Never resolves: the switcher stays "opening", as during a double click.
    listProfiles.mockReturnValue(new Promise(() => {}));
    void openProfileSwitcher();
    void openProfileSwitcher();
    void openProfileSwitcher();
    expect(listProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('profile switcher after a failure', () => {
  it('can be opened again when loading the profiles failed', async () => {
    vi.resetModules();
    listProfiles.mockReset().mockRejectedValueOnce(new Error('offline')).mockReturnValue(new Promise(() => {}));
    activeProfileId.mockReset().mockResolvedValue(null);
    const { openProfileSwitcher: open } = await import('./picker');
    await expect(open()).rejects.toThrow('offline');
    void open();
    expect(listProfiles).toHaveBeenCalledTimes(2);
  });
});

describe('profile editor Escape', () => {
  it('cancels the editor and consumes Escape before the picker Back handler', async () => {
    const { handleProfileEditorEscape } = await import('./picker');
    const cancel = vi.fn();
    const event = { key: 'Escape', target: null, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handleProfileEditorEscape(event, cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it("treats a remote's Back like Escape, so it steps back rather than closing the picker", async () => {
    const { handleProfileEditorEscape } = await import('./picker');
    const cancel = vi.fn();
    const event = { key: 'BrowserBack', target: null, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handleProfileEditorEscape(event, cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it('preserves an editing field consuming Escape and ignores other keys', async () => {
    const { handleProfileEditorEscape } = await import('./picker');
    const cancel = vi.fn();
    for (const [key, defaultPrevented] of [['Escape', true], ['Enter', false]] as const) {
      handleProfileEditorEscape({ key, target: null, defaultPrevented, preventDefault: vi.fn(), stopPropagation: vi.fn() }, cancel);
    }
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('leaving Theme Studio before a switch', () => {
  function steps(unsaved: boolean, answer: () => Promise<boolean>) {
    const log: string[] = [];
    let dismissed = false;
    const step = {
      unsaved: () => unsaved,
      ask: () => {
        log.push('ask');
        return answer();
      },
      dismissed: () => dismissed,
      stepAside: () => log.push('aside'),
      stepBack: () => log.push('back'),
      stay: () => {
        log.push('stay');
        dismissed = true;
      },
    };
    return { step, log, dismiss: () => (dismissed = true) };
  }

  it('goes on at once with nothing unsaved', async () => {
    const { leaveStudioFirst } = await import('./picker');
    const { step, log } = steps(false, () => Promise.resolve(true));
    expect(await leaveStudioFirst(step)).toBe(true);
    expect(log).toEqual([]);
  });

  it('steps aside (layer and Back handler) before the Studio asks, and back once it lets go', async () => {
    const { leaveStudioFirst } = await import('./picker');
    const { step, log } = steps(true, () => Promise.resolve(true));
    expect(await leaveStudioFirst(step)).toBe(true);
    expect(log).toEqual(['aside', 'ask', 'back']);
  });

  it('closes without coming back on "Keep editing"', async () => {
    const { leaveStudioFirst } = await import('./picker');
    const { step, log } = steps(true, () => Promise.resolve(false));
    expect(await leaveStudioFirst(step)).toBe(false);
    expect(log).toEqual(['aside', 'ask', 'stay']);
  });

  it('never comes back or switches when the picker was closed while the Studio asked', async () => {
    const { leaveStudioFirst } = await import('./picker');
    let answer: (left: boolean) => void = () => {};
    const { step, log, dismiss } = steps(true, () => new Promise<boolean>((resolve) => (answer = resolve)));
    const going = leaveStudioFirst(step);
    dismiss();
    answer(true);
    expect(await going).toBe(false);
    expect(log).toEqual(['aside', 'ask']);
  });
});
