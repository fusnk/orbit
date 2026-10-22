/**
 * Some addons answer a failed catalog request with a fake item ("Error Loading
 * Content", "No results", a poster with a big X) instead of an error or an
 * empty list. Those can't be opened, so they're dropped and an all-placeholder
 * catalog behaves like an empty one.
 *
 * Conservative on purpose, so a real title is never lost: an item is dropped
 * when its id is itself a placeholder word ("error", "tmdb:error",
 * "noresults"), or when its name is an error phrase AND something else agrees
 * (an error-message description, or an id with no number in it, which real
 * catalog ids nearly always have). An IMDb id is never dropped on its name alone.
 */

interface PreviewLike {
  id: string;
  name: string;
  description?: string | undefined;
}

const PLACEHOLDER_WORDS =
  'error|errors|err|noresults?|nocontent|nothing|notfound|empty|none|null|undefined|nan|placeholder|invalid|unknown|loading|failed|failure|unavailable';

// The whole id, optionally behind addon prefixes ("tmdb:", "aiostreams-"), is a placeholder word.
const PLACEHOLDER_ID = new RegExp(`^(?:[a-z0-9]+[:._-])*(?:${PLACEHOLDER_WORDS}|no[-_]?(?:results?|content)|not[-_]found)$`, 'i');

// Names, after `normalise`, that addons put on their fake items. Matched in full.
const ERROR_NAME =
  /^(?:errors?(?: (?:loading|fetching|getting) (?:content|catalog|data|items|results))?|error (?:occurred|invalid .*|code .*)|an error occurred|no (?:content|results|items|titles|metas|data|catalog)(?: (?:found|available))?|nothing (?:found|here)|something went wrong|(?:invalid|missing|expired) (?:api )?(?:key|token)|failed to (?:load|fetch)(?: .*)?|(?:loading|request) failed|not found|(?:content )?unavailable)$/;

// Wording only an error message uses, anywhere in the description.
const ERROR_DESCRIPTION =
  /\b(?:try again|api key|(?:could ?not|couldn't|unable to|failed to) (?:load|fetch|get|retrieve|find|connect)|error (?:loading|fetching|getting|occurred)|an error|no (?:results|content) (?:found|available)|something went wrong|check your (?:configuration|config|settings|addon))\b/i;

/** Lowercase letters, digits and single spaces: drops emoji, brackets and punctuation like "[❌] Error:". */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function isPlaceholderMeta(meta: PreviewLike): boolean {
  if (PLACEHOLDER_ID.test(meta.id)) return true;
  if (/^tt\d+$/i.test(meta.id)) return false;
  if (!ERROR_NAME.test(normalise(meta.name))) return false;
  return ERROR_DESCRIPTION.test(meta.description ?? '') || !/\d/.test(meta.id);
}

/** `metas` without placeholder items; logs (no URLs or names) when any were dropped. */
export function withoutPlaceholders<T extends PreviewLike>(metas: T[]): T[] {
  const kept = metas.filter((meta) => !isPlaceholderMeta(meta));
  if (kept.length < metas.length) console.debug(`Dropped ${metas.length - kept.length} placeholder item(s) from a catalog`);
  return kept;
}
