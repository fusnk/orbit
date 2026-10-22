/**
 * Undo and redo for Theme Studio: a list of states with a cursor. Each change
 * records the new state; a run of changes to the same thing close together
 * (typing a name, dragging a colour) shares one step, so undo takes back the
 * whole edit.
 * The oldest steps drop off past `limit`.
 */
export interface History<T> {
  readonly current: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Records `state`. With the same `group` as the change just before it, replaces that step instead. */
  push(state: T, group?: string): void;
  undo(): T;
  redo(): T;
  /** Starts again from `state` (after saving, or when the edit is thrown away). */
  reset(state: T): void;
}

/** Changes to one thing further apart than this are separate steps. */
const GROUP_MS = 1500;

export function createHistory<T>(initial: T, limit = 100, now: () => number = Date.now): History<T> {
  let states: T[] = [initial];
  let index = 0;
  let lastGroup: string | undefined;
  let lastTime = 0;

  return {
    get current() {
      return states[index]!;
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < states.length - 1;
    },
    push(state, group) {
      states = states.slice(0, index + 1);
      const time = now();
      if (group !== undefined && group === lastGroup && index > 0 && time - lastTime < GROUP_MS) {
        states[index] = state;
      } else {
        states.push(state);
        if (states.length > limit + 1) states = states.slice(states.length - limit - 1);
        index = states.length - 1;
      }
      lastGroup = group;
      lastTime = time;
    },
    undo() {
      if (index > 0) index--;
      lastGroup = undefined;
      return states[index]!;
    },
    redo() {
      if (index < states.length - 1) index++;
      lastGroup = undefined;
      return states[index]!;
    },
    reset(state) {
      states = [state];
      index = 0;
      lastGroup = undefined;
    },
  };
}
