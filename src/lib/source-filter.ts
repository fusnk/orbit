/**
 * The "which addon" filter shared by the source picker and the player's
 * Source panel. With several stream addons a title can have hundreds of
 * sources; this narrows the list to one addon's.
 *
 * Addons are told apart by the name the person sees, which is also what
 * both lists have (the player's sources carry no addon key).
 */

export interface AddonGroup {
  addon: string;
  count: number;
}

/**
 * The addons the sources come from, most sources first. Ties keep the order
 * the sources came in, so with a ranked list the addon with the better source
 * goes first. (Sort is stable.)
 */
export function addonGroups(sources: readonly { addon: string }[]): AddonGroup[] {
  const counts = new Map<string, number>();
  for (const { addon } of sources) counts.set(addon, (counts.get(addon) ?? 0) + 1);
  return [...counts].map(([addon, count]) => ({ addon, count })).sort((a, b) => b.count - a.count);
}

/** The sources from `addon`, in their order; all of them for null. */
export const fromAddon = <T extends { addon: string }>(sources: readonly T[], addon: string | null): T[] => (addon === null ? [...sources] : sources.filter((s) => s.addon === addon));

/** Whether the filter is worth showing: only when the sources come from two addons or more. */
export const offerAddonFilter = (groups: readonly AddonGroup[]) => groups.length > 1;

/**
 * The addon chosen last, remembered for the rest of the session (not saved:
 * a filter left on by mistake shouldn't hide sources days later). Switching
 * profile reloads the window, so each profile starts with none.
 */
export function createAddonFilter() {
  let chosen: string | null = null;
  return {
    chosen: () => chosen,
    choose(addon: string | null): void {
      chosen = addon;
    },
    /**
     * The addon to filter by for these sources: the chosen one if it has
     * sources here (and there's more than one addon), else null for all.
     * Once the list is complete (`settled`) without it, it's forgotten, so a
     * later title with that addon again doesn't open filtered out of the blue.
     */
    resolve(groups: readonly AddonGroup[], settled: boolean): string | null {
      if (chosen === null) return null;
      const present = groups.some((g) => g.addon === chosen);
      if (!present && settled) chosen = null;
      return present && offerAddonFilter(groups) ? chosen : null;
    },
  };
}

/** The one the picker and the player share. */
export const addonFilter = createAddonFilter();
