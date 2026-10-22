import { describe, expect, it } from 'vitest';
import { editingAt, resumeEditing } from './text-field';

/** Just enough of an input for the editing state (tests run without a DOM). */
function fakeInput(readOnly: boolean, selection: [number, number] = [0, 0]) {
  const input = {
    readOnly,
    selectionStart: selection[0],
    selectionEnd: selection[1],
    focused: false,
    classList: { toggle: () => {} },
    focus() {
      input.focused = true;
    },
    setSelectionRange(start: number, end: number) {
      input.selectionStart = start;
      input.selectionEnd = end;
    },
  };
  return input;
}

describe('a field redrawn while it is being typed in (the Subtitles view\'s language search)', () => {
  it('goes on being typed in, where the typing was', () => {
    const before = fakeInput(false, [2, 2]);
    const at = editingAt(before as unknown as HTMLInputElement);
    const after = fakeInput(true);
    expect(at).not.toBeNull();
    resumeEditing(after as unknown as HTMLInputElement, at!);
    expect(after.readOnly).toBe(false);
    expect(after.focused).toBe(true);
    expect([after.selectionStart, after.selectionEnd]).toEqual([2, 2]);
  });

  it('a field only focused, not being typed in, has nothing to carry over', () => {
    expect(editingAt(fakeInput(true) as unknown as HTMLInputElement)).toBeNull();
  });
});
