import type { InstalledAddon, ResourceRequest, UsableAddon } from './types';

export function isUsable(addon: InstalledAddon): addon is UsableAddon {
  return addon.enabled && addon.urlReadable && addon.manifest !== null;
}

/** Whether `addon` declares support for `req` (resource, type, id prefix, extras). */
export function isEligible(addon: InstalledAddon, req: ResourceRequest): addon is UsableAddon {
  if (!isUsable(addon)) return false;
  const { manifest } = addon;

  if (req.resource === 'catalog') {
    const catalog = manifest.catalogs.find((c) => c.type === req.type && c.id === req.id);
    if (!catalog) return false;
    const given = new Set((req.extra ?? []).map(([name]) => name));
    const requiredMet = catalog.extra.every((e) => !e.isRequired || given.has(e.name));
    const allDeclared = [...given].every((name) => catalog.extra.some((e) => e.name === name));
    return requiredMet && allDeclared;
  }

  const resource = manifest.resources.find((r) => r.name === req.resource);
  if (!resource || !resource.types.includes(req.type)) return false;
  return !resource.idPrefixes || resource.idPrefixes.some((prefix) => req.id.startsWith(prefix));
}
