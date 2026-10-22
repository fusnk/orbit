/** One bounded request at a time; replies belong to a file generation. */
export function createInfoPoller(host: { active(): boolean; read(): Promise<Record<string, string>>; render(raw: Record<string, string>): void }) {
  let generation = 0;
  let pending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function refresh(): void {
    clearTimeout(timer);
    if (disposed || !host.active() || pending) return;
    const current = generation;
    pending = true;
    void host.read().then((raw) => {
      if (!disposed && current === generation && host.active()) host.render(raw);
    }).catch(() => {}).finally(() => {
      pending = false;
      if (disposed) return;
      if (current !== generation) refresh();
      else if (host.active()) timer = setTimeout(refresh, 2000);
    });
  }
  return {
    refresh,
    reset(): void { generation++; clearTimeout(timer); refresh(); },
    dispose(): void { disposed = true; generation++; clearTimeout(timer); },
  };
}
