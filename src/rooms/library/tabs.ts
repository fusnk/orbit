/**
 * Which of My Library's views get a button: the ones with something in them,
 * plus a few that make sense empty (index.ts counts what each holds).
 */
export function shownTabs<T extends { id: string }>(tabs: readonly T[], counts: ReadonlyMap<string, number>, current: string): T[] {
  const any = [...counts.values()].some(Boolean);
  return tabs.filter((t) => {
    if ((counts.get(t.id) ?? 0) > 0) return true;
    // Stats shows beside any other tab, so its empty state can explain how it fills in; My Lists too,
    // since "Import a list" lives there and a first list may well come from a file.
    if (t.id === 'all' || t.id === 'stats' || t.id === 'lists') return any;
    // The queue, favourite episodes and history stay while open, so removing the last item shows the empty state rather than another tab.
    return (t.id === 'queue' || t.id === 'favourites' || t.id === 'history') && current === t.id;
  });
}
