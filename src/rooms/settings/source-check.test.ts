import { describe, expect, it, vi } from 'vitest';
import { createSourceCheck } from './source-check';

function setup() {
  const ui = { checking: vi.fn(), done: vi.fn(), failed: vi.fn(), idle: vi.fn() };
  return { ui, check: createSourceCheck<string>(ui) };
}

describe('checking a Live TV source', () => {
  it('shows the wait, then the answer, then an editable form', async () => {
    const { ui, check } = setup();
    await check.start(Promise.resolve('ok'));
    expect(ui.checking).toHaveBeenCalledOnce();
    expect(ui.done).toHaveBeenCalledWith('ok');
    expect(ui.idle).toHaveBeenCalledOnce();
    expect(check.pending).toBe(false);
  });

  it('says what went wrong and is editable again', async () => {
    const { ui, check } = setup();
    await check.start(Promise.reject(new Error('refused')));
    expect(ui.failed).toHaveBeenCalledOnce();
    expect(ui.done).not.toHaveBeenCalled();
    expect(ui.idle).toHaveBeenCalledOnce();
  });

  it('Cancel makes the form editable at once and ignores the late answer', async () => {
    const { ui, check } = setup();
    let finish!: (value: string) => void;
    const slow = check.start(new Promise<string>((resolve) => (finish = resolve)));
    expect(check.pending).toBe(true);
    check.cancel();
    expect(check.pending).toBe(false);
    expect(ui.idle).toHaveBeenCalledOnce();
    finish('late');
    await slow;
    expect(ui.done).not.toHaveBeenCalled();
    expect(ui.failed).not.toHaveBeenCalled();
    expect(ui.idle).toHaveBeenCalledOnce();
  });

  it('a check started after Cancel is answered as usual', async () => {
    const { ui, check } = setup();
    let finish!: (value: string) => void;
    const slow = check.start(new Promise<string>((resolve) => (finish = resolve)));
    check.cancel();
    await check.start(Promise.resolve('second'));
    expect(ui.done).toHaveBeenCalledExactlyOnceWith('second');
    finish('first, late');
    await slow;
    expect(ui.done).toHaveBeenCalledOnce();
  });

  it('Cancel with nothing pending does nothing', () => {
    const { ui, check } = setup();
    check.cancel();
    expect(ui.idle).not.toHaveBeenCalled();
  });
});
