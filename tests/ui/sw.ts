/**
 * The app fixture's artwork (app-fixture.ts): every request for another host is answered here,
 * so the page never reaches the network. Posters, backgrounds and logos are drawn as SVG from
 * their address (a colour from the address, the title from its file name); anything else is a 404.
 * Served by Vite as a module worker, scoped to /tests/ui/.
 */
interface FetchEvent extends Event {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface Scope {
  addEventListener(type: 'install' | 'activate', listener: (event: Event & { waitUntil(p: Promise<unknown>): void }) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
}
const scope = self as unknown as Scope;
export {};

scope.addEventListener('install', () => void scope.skipWaiting());
scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()));

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const KINDS = /\/(poster|background|logo|still|thumb|avatar|channel|face|provider)[/-]/;

/** Title-cased words from a file name: `the-last-harbor.svg` or `poster-the-last-harbor.jpg` → `The Last Harbor`. */
function words(path: string): string {
  const file = decodeURIComponent(path.split('/').pop() ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^(poster|background|logo|still|thumb|avatar|channel|face|provider)-/, '');
  return file.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Rolling hills from `seed`: a path across the picture at about `y` (0–1 of its height). */
function hills(seed: number, w: number, h: number, y: number, rough: number): string {
  const steps = 6;
  let d = `M0 ${h}`;
  for (let i = 0; i <= steps; i++) d += ` L${(w * i) / steps} ${h * (y - (((seed >> (i * 3)) & 7) / 7) * rough)}`;
  return `${d} L${w} ${h} Z`;
}

function art(url: URL): string {
  const kind = KINDS.exec(url.pathname)?.[1] ?? (/\/w(?:780|1280)|original/.test(url.pathname) ? 'background' : 'poster');
  const seed = hash(url.pathname.replace(KINDS, '/'));
  const hue = seed % 360;
  const title = url.searchParams.get('t') ?? words(url.pathname);
  const name = escapeXml(title);
  const [w, h] = kind === 'poster' ? [400, 600] : kind === 'logo' ? [800, 300] : kind === 'avatar' || kind === 'channel' || kind === 'face' || kind === 'provider' ? [300, 300] : [1280, 720];
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  if (kind === 'logo') {
    return svg(`<text x="50%" y="58%" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${Math.max(48, Math.min(110, 1400 / Math.max(name.length, 1)))}" fill="#fff" stroke="hsl(${hue} 60% 20%)" stroke-width="3" paint-order="stroke">${name}</text>`);
  }
  const sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 46%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 12%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  if (kind === 'face' || kind === 'avatar') {
    // Head and shoulders.
    return svg(`${sky}<circle cx="150" cy="120" r="58" fill="hsl(${(hue + 20) % 360} 30% 78%)"/><path d="M40 300 C40 210 100 190 150 190 C200 190 260 210 260 300 Z" fill="hsl(${(hue + 200) % 360} 35% 30%)"/>`);
  }
  if (kind === 'channel' || kind === 'provider') {
    return svg(`${sky}<text x="50%" y="62%" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="120" fill="#fff">${escapeXml(title.slice(0, 2))}</text>`);
  }
  // A landscape: a sun or moon, a far range, a near range and a figure, so stills and backdrops read as scenes.
  const sun = `<circle cx="${0.2 * w + (seed % 60) / 100 * w}" cy="${h * (0.22 + ((seed >> 4) % 20) / 100)}" r="${Math.min(w, h) * 0.12}" fill="hsl(${(hue + 30) % 360} 90% 80% / .85)"/>`;
  const far = `<path d="${hills(seed, w, h, 0.62, 0.22)}" fill="hsl(${(hue + 200) % 360} 30% 28% / .8)"/>`;
  const near = `<path d="${hills(seed >> 5, w, h, 0.8, 0.14)}" fill="hsl(${hue} 35% 9%)"/>`;
  const fx = 0.55 * w + ((seed >> 7) % 30) / 100 * w;
  const figure = kind === 'poster' ? '' : `<g fill="hsl(${hue} 35% 6%)"><circle cx="${fx}" cy="${h * 0.6}" r="${h * 0.035}"/><rect x="${fx - h * 0.03}" y="${h * 0.63}" width="${h * 0.06}" height="${h * 0.16}" rx="${h * 0.02}"/></g>`;
  const label = kind === 'poster' ? `<text x="50%" y="88%" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${Math.max(24, Math.min(44, 620 / Math.max(name.length, 1)))}" fill="#fff">${name}</text>` : '';
  return svg(sky + sun + far + near + figure + label);
}

/** Pages that asked for no artwork (`no-art` / `offline`): every picture fails, as with no network or a dead CDN. */
const noArt = new Set<string>();
(self as unknown as { addEventListener(type: 'message', listener: (event: MessageEvent) => void): void }).addEventListener('message', (event) => {
  const id = (event.source as { id?: string } | null)?.id;
  const wanted = (event.data as { noArt?: boolean } | null)?.noArt;
  if (id && wanted) noArt.add(id);
  else if (id && wanted === false) noArt.delete(id);
  event.ports[0]?.postMessage(true);
});

scope.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === scope.location.origin) return;
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' };
  if (noArt.has((event as unknown as { clientId: string }).clientId)) {
    event.respondWith(Response.error());
    return;
  }
  if (event.request.destination === 'image' || /\.(jpe?g|png|webp|svg|gif)$/i.test(url.pathname)) {
    event.respondWith(new Response(art(url), { headers: { ...headers, 'content-type': 'image/svg+xml' } }));
  } else {
    event.respondWith(new Response('', { status: 404, headers }));
  }
});
