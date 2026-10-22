// Minimal Stremio-protocol addon with no dependencies, for testing Orbit end
// to end. Serves a catalog, metadata, and streams for public-domain / CC films,
// one "series" made of those films (to exercise episodes), and simple
// generated test subtitles so subtitle addons can be exercised.
import { createServer } from 'node:http';
import { films } from './films.js';

// 127.0.0.1 only: it's a local test fixture, and Orbit allows plain http
// solely for that address.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 7000;
const PAGE_SIZE = 100;
const GENRES = [...new Set(films.flatMap((f) => f.genres))].sort();

/** The Blender open movies, in release order, as season 1 of one show. */
const SHOW = {
  id: 'orbitpd:blender-shorts',
  name: 'Blender Open Movie Shorts',
  releaseInfo: '2006–2012',
  genres: ['Animation'],
  poster: films.find((f) => f.id === 'orbitpd:sintel').poster,
  description:
    'The Blender Foundation’s open movies gathered as one season, for testing series playback. Each film keeps its own CC BY licence, credited on its page.',
  episodes: ['orbitpd:elephants-dream', 'orbitpd:big-buck-bunny', 'orbitpd:sintel', 'orbitpd:tears-of-steel'],
};

/** The film behind an episode id like `orbitpd:blender-shorts:1:3`. */
function episodeFilm(id) {
  const match = new RegExp(`^${SHOW.id}:1:(\\d+)$`).exec(id);
  const filmId = match ? SHOW.episodes[Number(match[1]) - 1] : undefined;
  return films.find((f) => f.id === filmId);
}

const manifest = {
  id: 'org.orbit.example.open-films',
  version: '1.0.0',
  name: 'Orbit Example: Open Films',
  description: 'Public-domain and Creative Commons films for testing Orbit end to end.',
  types: ['movie', 'series'],
  idPrefixes: ['orbitpd:'],
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  catalogs: [
    {
      type: 'movie',
      id: 'open-films',
      name: 'Open Films',
      extra: [{ name: 'search' }, { name: 'genre', options: GENRES }, { name: 'skip' }],
    },
    { type: 'series', id: 'open-series', name: 'Open Series' },
  ],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const preview = ({ id, name, releaseInfo, poster, description, genres }, type = 'movie') => ({
  id,
  type,
  name,
  releaseInfo,
  poster,
  posterShape: 'poster',
  description,
  genres,
});

function catalog(extra) {
  const search = extra.get('search')?.toLowerCase();
  const genre = extra.get('genre');
  const skip = Number(extra.get('skip')) || 0;
  const matches = films.filter(
    (f) => (!search || f.name.toLowerCase().includes(search)) && (!genre || f.genres.includes(genre)),
  );
  return { metas: matches.slice(skip, skip + PAGE_SIZE).map((film) => preview(film)) };
}

function meta(type, id) {
  if (type === 'series') {
    if (id !== SHOW.id) return { meta: null };
    const videos = SHOW.episodes.map((filmId, i) => {
      const film = films.find((f) => f.id === filmId);
      return { id: `${SHOW.id}:1:${i + 1}`, title: film.name, season: 1, episode: i + 1, released: `${film.releaseInfo}-01-01T00:00:00.000Z`, thumbnail: film.poster };
    });
    return { meta: { ...preview(SHOW, 'series'), videos } };
  }
  const film = films.find((f) => f.id === id);
  return film ? { meta: { ...preview(film), runtime: film.runtime } } : { meta: null };
}

function streams(id) {
  const film = films.find((f) => f.id === id) ?? episodeFilm(id);
  if (!film) return { streams: [] };
  return {
    streams: [
      { url: film.stream.url, name: 'Open Films', description: `${film.stream.quality} · direct` },
      ...(film.alternates ?? []).map((alt) => ({ url: alt.url, name: 'Open Films', description: `${alt.quality} · ${alt.host}` })),
    ],
  };
}

const SUBTITLE_LANGS = { eng: 'Test subtitle', spa: 'Subtítulo de prueba' };

function subtitles(id) {
  if (!films.some((f) => f.id === id) && !episodeFilm(id)) return { subtitles: [] };
  return {
    subtitles: Object.keys(SUBTITLE_LANGS).map((lang) => ({
      id: `${id}-${lang}`,
      url: `http://${HOST}:${PORT}/subs/${encodeURIComponent(id)}/${lang}.srt`,
      lang,
    })),
  };
}

/** An SRT with one numbered cue every 10 seconds for the first two minutes. */
function srt(lang) {
  const stamp = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
  return Array.from({ length: 12 }, (_, i) => `${i + 1}\n${stamp(i * 10 + 1)} --> ${stamp(i * 10 + 8)}\n${SUBTITLE_LANGS[lang]} ${i + 1}\n`).join('\n');
}

function route(path) {
  if (path === '/manifest.json') return manifest;
  const match = /^\/(catalog|meta|stream|subtitles)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path);
  if (!match) return null;
  const [, resource, type, rawId, rawExtra] = match;
  if (type !== 'movie' && type !== 'series') return null;
  const id = decodeURIComponent(rawId);
  if (resource === 'catalog') {
    if (type === 'series') return id === 'open-series' ? { metas: [preview(SHOW, 'series')] } : null;
    return id === 'open-films' ? catalog(new URLSearchParams(rawExtra ?? '')) : null;
  }
  if (resource === 'meta') return meta(type, id);
  if (resource === 'subtitles') return subtitles(id);
  return streams(id);
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
  const subtitle = /^\/subs\/[^/]+\/(eng|spa)\.srt$/.exec(path);
  if (subtitle && req.method === 'GET') {
    console.log(`GET ${path} → 200`);
    res.writeHead(200, { 'Content-Type': 'application/x-subrip; charset=utf-8' });
    return res.end(srt(subtitle[1]));
  }
  const body = req.method === 'GET' ? route(path) : null;
  console.log(`${req.method} ${path} → ${body ? 200 : 404}`);
  res.writeHead(body ? 200 : 404, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body ?? { error: 'not found' }));
}).listen(PORT, HOST, () => {
  console.log(`Open Films addon: http://${HOST}:${PORT}/manifest.json`);
});
