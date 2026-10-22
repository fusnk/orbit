import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

describe('Theme Studio history', () => {
  it('undoes and redoes, and a new change drops what was undone', () => {
    const history = createHistory('a');
    history.push('b');
    history.push('c');
    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe('b');
    history.push('d');
    expect(history.canRedo).toBe(false);
    expect([history.undo(), history.undo()]).toEqual(['b', 'a']);
  });

  it('makes one step of a quick run of changes to the same thing', () => {
    let now = 0;
    const history = createHistory('', 100, () => now);
    for (const text of ['N', 'Ne', 'Neo']) {
      now += 100;
      history.push(text, 'name');
    }
    now += 5000;
    history.push('Neon', 'name');
    expect(history.undo()).toBe('Neo');
    expect(history.undo()).toBe('');
  });

  it('keeps at most `limit` steps', () => {
    const history = createHistory(0, 3);
    for (let i = 1; i <= 10; i++) history.push(i);
    let steps = 0;
    while (history.canUndo) {
      history.undo();
      steps++;
    }
    expect([steps, history.current]).toEqual([3, 7]);
  });

  it('starts again from a saved state', () => {
    const history = createHistory(1);
    history.push(2);
    history.reset(5);
    expect([history.current, history.canUndo, history.canRedo]).toEqual([5, false, false]);
  });
});
