import type { ResourceRequest } from './types';

/**
 * Builds `/{resource}/{type}/{id}[/{extra}].json`. Every part is
 * percent-encoded like stremio-core does, so an id or search term can't add
 * path segments (`/`) or break out of its position.
 */
export function buildPath({ resource, type, id, extra }: ResourceRequest): string {
  const base = `/${resource}/${encode(type)}/${encode(id)}`;
  if (!extra?.length) return `${base}.json`;
  const query = extra.map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  return `${base}/${query}.json`;
}

/**
 * `encodeURIComponent` throws on half of an emoji (a lone surrogate), e.g. a
 * search cut at a length limit; that would fail the whole load, so it's
 * replaced with U+FFFD first.
 */
const encode = (part: string): string => encodeURIComponent(part.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\ufffd'));
