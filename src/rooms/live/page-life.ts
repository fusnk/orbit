/**
 * The Live TV page's loads and subscriptions: a reload started later always
 * wins over one started earlier (whichever answers last), and once the page
 * is discarded nothing keeps listening, ticking or drawing.
 */
import { VIEW_DISCARDED } from '../../app/router';

export function pageLife(view: EventTarget) {
  let latest = 0;
  let gone = false;
  const cleanups: (() => void)[] = [];
  view.addEventListener(
    VIEW_DISCARDED,
    () => {
      gone = true;
      latest++;
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
    { once: true },
  );

  function onDiscard(cleanup: () => void): void {
    if (gone) cleanup();
    else cleanups.push(cleanup);
  }

  return {
    /** Starts a load; the check says whether it's still the newest (no later load, page still there). */
    begin(): () => boolean {
      const mine = ++latest;
      return () => !gone && mine === latest;
    },
    /** Runs `cleanup` when the page is discarded (at once if it already is). */
    onDiscard,
    /** As `onDiscard`, for a listener still being set up (Tauri's `listen` answers with its unlisten later). */
    track(pending: Promise<() => void>): void {
      pending.then(onDiscard, (err: unknown) => console.warn('Could not listen for Live TV updates', err));
    },
  };
}
