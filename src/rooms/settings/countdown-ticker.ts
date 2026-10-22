/**
 * A countdown's once-a-second tick that runs only while it's wanted (a code
 * is showing) and seen (on screen, in a shown window). Settings is kept for
 * the whole session, so a tick left running behind another page would wake
 * the CPU every second for as long as Orbit stays open. Seen again, it ticks
 * at once, so the time shown is right straight away.
 */
export function createTicker(tick: () => void, every = 1000): { want(on: boolean): void; seen(on: boolean): void } {
  let wanted = false;
  let seen = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = () => {
    const run = wanted && seen;
    if (run && timer === undefined) {
      tick();
      timer = setInterval(tick, every);
    } else if (!run && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  return {
    want(on) {
      wanted = on;
      sync();
    },
    seen(on) {
      seen = on;
      sync();
    },
  };
}
