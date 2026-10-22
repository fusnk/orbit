/**
 * The wait while a Live TV source is checked: Rust downloads its channel list,
 * which can take minutes from a slow provider. Cancel abandons the wait on the
 * page, so the form is editable again at once and the answer, when it comes, is
 * ignored. The check itself runs on in Rust (`iptv_add` has no cancel), so a
 * late success still adds the source, and the list shows it then.
 */
export interface SourceCheckUi<T> {
  /** The wait started: "Checking…", Cancel offered. */
  checking: () => void;
  done: (result: T) => void;
  failed: (err: unknown) => void;
  /** The form is editable again, after an answer or Cancel. */
  idle: () => void;
}

export function createSourceCheck<T>(ui: SourceCheckUi<T>) {
  let attempt = 0;
  let pending = false;
  const settle = (mine: number, show: () => void) => {
    if (mine !== attempt) return;
    pending = false;
    show();
    ui.idle();
  };
  return {
    get pending(): boolean {
      return pending;
    },
    async start(work: Promise<T>): Promise<void> {
      const mine = ++attempt;
      pending = true;
      ui.checking();
      try {
        const result = await work;
        settle(mine, () => ui.done(result));
      } catch (err) {
        settle(mine, () => ui.failed(err));
      }
    },
    /** Gives up waiting: the answer, if it ever comes, changes nothing on the page. */
    cancel(): void {
      if (!pending) return;
      attempt++;
      pending = false;
      ui.idle();
    },
  };
}
