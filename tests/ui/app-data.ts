/**
 * Sample data for the app fixture (app-fixture.ts): a Cinemeta-style catalog of made-up films and
 * shows, and the profile's library, history, lists and Live TV built from it. Artwork addresses
 * point at hosts the fixture's service worker (sw.ts) draws, so nothing reaches the network.
 * Dates are relative to now, so "new episode", "airs tomorrow" and "on now" stay true.
 */

export const DAY = 86_400_000;
export const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Addon artwork (the service worker writes the name from the file name). */
export const art = (kind: 'poster' | 'background' | 'logo' | 'still' | 'channel', name: string) => `https://art.orbit.test/${kind}/${slug(name)}.svg?t=${encodeURIComponent(name)}`;
/** TMDB artwork, as Rust would build it (image.tmdb.org only). */
export const tmdbArt = (kind: 'poster' | 'background' | 'logo' | 'face' | 'provider', name: string) =>
  `https://image.tmdb.org/t/p/${kind === 'background' ? 'w1280' : kind === 'provider' ? 'w92' : 'w500'}/${kind}-${slug(name)}.jpg`;

type Row = [name: string, year: number, genres: string[], rating: number, minutes: number, blurb: string];

const MOVIES: Row[] = [
  ['The Last Harbor', 2024, ['Drama', 'Thriller'], 7.8, 128, 'A retired harbor pilot is pulled back for one final night crossing when a storm traps a cargo ship carrying something its owners will kill to keep hidden.'],
  ['Neon Meridian', 2023, ['Sci-Fi', 'Action'], 7.4, 141, 'In a city that never switches its lights off, a courier discovers the packages she delivers are memories, and one of them is her own.'],
  ['Paper Lanterns', 2022, ['Romance', 'Drama'], 7.1, 112, 'Two strangers share a cramped festival stall for a week and slowly realise they have met before, ten years and an ocean ago.'],
  ['Dust Over Calder', 2021, ['Western', 'Drama'], 7.6, 134, 'A widowed rancher and a drifter with a forged badge hold a dying town together against the railroad men who want its water.'],
  ['The Quiet Algorithm', 2024, ['Thriller', 'Mystery'], 7.2, 118, 'A data analyst notices her company’s model predicting crimes before they happen, including one she has not committed yet.'],
  ['Summer of the Comet', 2023, ['Family', 'Adventure'], 7.0, 104, 'Four kids build a telescope out of junkyard parts to prove the comet everyone is ignoring is about to put on the show of the century.'],
  ['Iron Orchard', 2020, ['War', 'Drama'], 8.1, 152, 'A platoon stranded in an apple orchard behind enemy lines must decide who among them will carry the wounded home.'],
  ['Midnight at the Gallery', 2022, ['Comedy', 'Crime'], 6.8, 99, 'A night guard, a failed painter and a forger with stage fright plan the most polite art heist in history.'],
  ['Hollow Pines', 2023, ['Horror', 'Mystery'], 6.6, 97, 'A family rents a cabin whose previous guests all left five-star reviews and never went home.'],
  ['The Cartographer’s Daughter', 2021, ['Adventure', 'History'], 7.5, 137, 'In 1820, a mapmaker’s daughter sets out to finish the chart of a coast her father died trying to reach.'],
  ['Velocity Nine', 2024, ['Action', 'Thriller'], 6.9, 116, 'A getaway driver is offered a clean slate if she can win one illegal race across three borders in a single night.'],
  ['Small Mercies', 2022, ['Drama'], 7.9, 121, 'A night-shift nurse keeps a ledger of every kindness she witnesses, until the hospital decides to close her ward.'],
  ['Starfall Academy', 2024, ['Animation', 'Family', 'Fantasy'], 7.3, 95, 'A clumsy young star is sent to a school for constellations and must learn to shine before the longest night of the year.'],
  ['The Long Weekend', 2023, ['Comedy', 'Romance'], 6.7, 101, 'Three couples, one rented villa and a wedding nobody admits they are dreading.'],
  ['Undertow', 2020, ['Thriller', 'Crime'], 7.0, 109, 'A detective returns to the fishing village she escaped as a teenager to investigate a drowning that looks too much like her sister’s.'],
  ['Glass Monarch', 2021, ['Drama', 'Biography'], 7.7, 143, 'The rise and fall of a glassmaker who built an empire from a single furnace and lost it to a single lie.'],
  ['Echoes of Tomorrow', 2024, ['Sci-Fi', 'Drama'], 7.6, 131, 'A physicist receives voicemails from her future self, each one warning her about a different version of the same mistake.'],
  ['Brass and Bone', 2022, ['Fantasy', 'Adventure'], 6.9, 126, 'A clockwork knight and a gravedigger’s apprentice cross a kingdom where the dead have stopped staying buried.'],
  ['Last Call at Rosie’s', 2021, ['Comedy', 'Drama'], 7.2, 103, 'On the final night before the neighbourhood bar closes for good, its regulars try to raise the money to save it.'],
  ['The Thirteenth Floor Down', 2023, ['Horror', 'Thriller'], 6.4, 94, 'An elevator repairman is called to a building whose lift keeps stopping at a floor that does not exist.'],
  ['Northern Lights Express', 2022, ['Family', 'Comedy'], 6.5, 98, 'A family’s holiday train trip to see the aurora goes wrong in every possible way, and a few impossible ones.'],
  ['The Archivist', 2024, ['Mystery', 'Drama'], 7.4, 119, 'A library archivist finds a letter tucked into a donated book that seems to confess to a murder in her own family.'],
  ['Red Desert Run', 2020, ['Action', 'Adventure'], 6.6, 112, 'Two rival rally drivers are forced to team up when their cars break down a hundred miles from the nearest road.'],
  ['Kites Over Kabul Street', 2023, ['Drama', 'Family'], 7.8, 115, 'A boy and his grandfather enter the neighbourhood kite contest, and discover what each of them has been flying away from.'],
  ['Silent Partners', 2021, ['Crime', 'Thriller'], 7.1, 122, 'Two accountants who launder money for the mob decide to launder some for themselves.'],
  ['Wild Honey', 2022, ['Romance', 'Comedy'], 6.6, 100, 'A beekeeper and a city chef clash over a farmers’ market stall, and then over a lot more than honey.'],
  ['The Weight of Snow', 2024, ['Drama', 'Thriller'], 7.5, 127, 'Snowed in at a mountain lodge, a jury of strangers must decide whether to report what they saw on the ski lift.'],
  ['Orbit of Ash', 2023, ['Sci-Fi', 'Horror'], 6.8, 108, 'The crew of a mining station hears knocking on the outside of the hull, a thousand kilometres from anything.'],
  ['Thunder Road Reunion', 2022, ['Documentary', 'Music'], 7.9, 92, 'A once-famous garage band reunites for one last tour of the small towns that made them.'],
  ['The Lighthouse Keeper’s Cat', 2021, ['Animation', 'Family'], 7.2, 88, 'When the keeper falls ill, his cat must keep the light burning through the worst storm in a century.'],
  ['Counterfeit Saints', 2024, ['Crime', 'Drama'], 7.3, 135, 'A forger of religious relics becomes the unlikely key witness in a Vatican fraud trial.'],
  ['Highwire', 2020, ['Biography', 'Drama'], 7.6, 117, 'The true-feeling story of a circus family that walked a wire between two skyscrapers and the daughter who refused to follow.'],
  ['Moonlight Diner', 2023, ['Comedy'], 6.9, 96, 'Over one long night shift, the staff of an all-night diner try to return a lost dog, a lost wallet and a lost bride.'],
  ['The Ninth Gate Protocol', 2022, ['Action', 'Sci-Fi'], 6.7, 124, 'An elite security team must defend a research facility from an intruder who already knows all of their moves.'],
  ['Saltwater Hymns', 2021, ['Drama', 'Romance'], 7.4, 118, 'A choir director in a fading port town falls for the fisherman who refuses to sing.'],
  ['Ghosts of Ward Street', 2024, ['Horror', 'Comedy'], 6.5, 93, 'Two ghost-tour guides who do not believe in ghosts are hired to clear an actual haunting.'],
  ['The Mapmaker’s Apprentice', 2023, ['Fantasy', 'Family'], 7.0, 109, 'A girl discovers that the maps she draws change the land they describe, and that someone wants her pen.'],
  ['Bulletproof Heart', 2022, ['Action', 'Romance'], 6.3, 111, 'A bodyguard falls for the witness she has been hired to protect, and the witness is not who she says she is.'],
  ['Tides of War', 2020, ['War', 'History'], 7.7, 148, 'A naval radio operator intercepts a message that could end the war, if anyone will believe her.'],
  ['A Year in Kyoto', 2024, ['Documentary'], 8.0, 89, 'Four seasons in the life of a family-run tofu shop that has opened every morning for two hundred years.'],
];

const SERIES: [...Row, seasons: number, ongoing: boolean][] = [
  ['Blackwater County', 2019, ['Crime', 'Drama'], 8.4, 52, 'A small-town sheriff uncovers a web of corruption that reaches from the trailer park to the state capitol.', 4, true],
  ['The Orbital', 2021, ['Sci-Fi', 'Drama'], 8.1, 48, 'Life aboard humanity’s first permanent space hotel, where the guests are rich, the staff are tired and the oxygen is metered.', 3, true],
  ['Kitchen Confidential', 2020, ['Comedy'], 7.6, 28, 'A disgraced celebrity chef starts over in a strip-mall restaurant with a staff that never asked for a celebrity.', 3, false],
  ['Hollow Crown Chronicles', 2018, ['Fantasy', 'Adventure'], 8.6, 58, 'Five kingdoms, one empty throne and a prophecy that everybody keeps misreading.', 4, false],
  ['Northside Precinct', 2022, ['Crime', 'Mystery'], 7.8, 45, 'Each season follows a single murder case from the first call to the final verdict.', 2, true],
  ['Little Planets', 2021, ['Animation', 'Family'], 7.9, 22, 'A family of tiny astronauts explores a new miniature world in every episode.', 3, true],
  ['The Inheritance', 2023, ['Drama', 'Thriller'], 8.0, 55, 'When a billionaire dies without a will, his five estranged children have one year to agree on everything.', 2, true],
  ['Signal Lost', 2020, ['Sci-Fi', 'Mystery'], 7.7, 47, 'A remote research station loses contact with the world and finds it was not the only thing that disappeared.', 2, false],
  ['Village Vets', 2019, ['Documentary', 'Family'], 7.4, 30, 'A year in the life of a country veterinary practice where no two days, or patients, are alike.', 4, false],
  ['Gold Rush Girls', 2022, ['Western', 'Drama'], 7.5, 50, 'Three sisters stake a claim in 1898 Klondike and refuse to sell it to anyone.', 2, false],
  ['Office of Lost Things', 2023, ['Comedy', 'Fantasy'], 7.8, 26, 'The staff of a lost property office discover that some of the things handed in are not from this world.', 2, true],
  ['Deep Cover', 2021, ['Thriller', 'Action'], 7.6, 49, 'An undercover agent spends so long inside a smuggling ring she is no longer sure which side she is on.', 3, false],
  ['The Bakehouse', 2020, ['Reality', 'Comedy'], 7.1, 42, 'Twelve amateur bakers, one tent and ten weeks of increasingly ambitious cakes.', 4, true],
  ['Harbour Lights', 2018, ['Drama', 'Romance'], 7.3, 44, 'The lives and loves of a seaside town told through the regulars of its oldest pub.', 3, false],
  ['Moonbase Kids', 2024, ['Animation', 'Sci-Fi', 'Family'], 7.6, 24, 'The first children born on the moon grow up, get into trouble and occasionally save the base.', 1, true],
  ['Cold Case Unit', 2022, ['Crime', 'Documentary'], 7.9, 46, 'Retired detectives revisit the cases that haunted their careers using modern forensics.', 2, false],
  ['Empire of Salt', 2021, ['History', 'Drama'], 8.2, 57, 'The merchant family that controlled the salt trade of medieval Venice, and the daughter who brought it down.', 2, false],
  ['Night Shift', 2023, ['Comedy', 'Drama'], 7.4, 30, 'An emergency room after midnight, where the patients are strange and the doctors are stranger.', 2, true],
  ['Dragonlight', 2022, ['Animation', 'Fantasy', 'Adventure'], 8.3, 24, 'A young dragon rider and her stubborn dragon protect the floating islands from the storms below.', 3, true],
  ['The Long Game', 2024, ['Sport', 'Drama'], 7.7, 51, 'A struggling lower-league football club is bought by a mysterious owner with a hundred-year plan.', 1, true],
  // Anime (TMDB's "anime" keyword)
  ['Blade of the Silent Moon', 2020, ['Animation', 'Action', 'Fantasy'], 8.5, 24, 'A swordswoman who cannot speak hunts the demon that stole her voice across a war-torn feudal Japan.', 3, true],
  ['Sky Garden Academy', 2022, ['Animation', 'Comedy', 'Drama'], 7.9, 24, 'At a school built on floating islands, a transfer student joins the gardening club that keeps the islands in the air.', 2, false],
  ['Mecha Requiem', 2019, ['Animation', 'Sci-Fi', 'Action'], 8.2, 25, 'Teenage pilots of salvaged war machines discover the enemy they were raised to fight is their own future.', 2, false],
  ['Spirit Lantern Café', 2023, ['Animation', 'Fantasy', 'Comedy'], 7.7, 23, 'A café that only opens after midnight serves tea to ghosts who have one last thing to say.', 1, true],
  ['Ronin Express', 2021, ['Animation', 'Adventure'], 8.0, 24, 'A masterless samurai guards a mail train crossing a country where the old ways and the railway collide.', 2, false],
];
const ANIME = new Set(['Blade of the Silent Moon', 'Sky Garden Academy', 'Mecha Requiem', 'Spirit Lantern Café', 'Ronin Express']);

export interface Video {
  id: string;
  title: string;
  season: number;
  episode: number;
  released: string;
  thumbnail: string;
  overview: string;
}

export interface Meta {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster: string;
  background: string;
  logo: string;
  description: string;
  releaseInfo: string;
  imdbRating: string;
  runtime: string;
  genres: string[];
  released: string;
  director: string[];
  writer: string[];
  cast: string[];
  country: string;
  awards?: string;
  status?: string;
  videos?: Video[];
}

const FIRST = ['Ava', 'Marcus', 'Lena', 'Tomás', 'Priya', 'Jonah', 'Mei', 'Oscar', 'Nadia', 'Felix', 'Ingrid', 'Rafael', 'Hana', 'Elliot', 'Zara', 'Daniel', 'Sofia', 'Kwame', 'Clara', 'Idris'];
const LAST = ['Calloway', 'Reyes', 'Lindqvist', 'Okafor', 'Brennan', 'Moreau', 'Tanaka', 'Hale', 'Petrov', 'Ashworth', 'Silva', 'Kowalski', 'Nakamura', 'Fitzgerald', 'Haddad', 'Mercer', 'Duarte', 'Varga', 'Whitlock', 'Achebe'];
const COUNTRIES = ['United States', 'United Kingdom', 'Canada', 'France', 'Germany', 'Japan', 'Australia', 'Spain', 'Ireland', 'South Korea'];
const person = (n: number) => `${FIRST[n % FIRST.length]} ${LAST[(n * 7 + 3) % LAST.length]}`;
const people = (seed: number, count: number) => Array.from({ length: count }, (_, i) => person(seed * 5 + i * 3));

const EPISODE_WORDS = ['Pilot', 'The Arrival', 'Old Debts', 'Crossing Lines', 'Low Tide', 'The Visitor', 'Fault Lines', 'Homecoming', 'Smoke and Mirrors', 'The Long Night', 'Ashes', 'Endgame'];

function movie([name, year, genres, rating, minutes, blurb]: Row, i: number): Meta {
  // The newest few came out this month (Home's "New" badges and Release radar), and two are still to come.
  const released = i < 3 ? NOW - (i * 9 + 4) * DAY : i === 3 ? NOW + 21 * DAY : i === 4 ? NOW + 48 * DAY : Date.UTC(year, (i * 5) % 12, 1 + ((i * 11) % 27));
  return {
    id: `tt${9100001 + i}`,
    type: 'movie',
    name,
    poster: art('poster', name),
    background: art('background', name),
    logo: art('logo', name),
    description: blurb,
    releaseInfo: String(i < 5 ? new Date(released).getUTCFullYear() : year),
    imdbRating: rating.toFixed(1),
    runtime: `${minutes} min`,
    genres,
    released: new Date(released).toISOString(),
    director: people(i, 1),
    writer: people(i + 40, 2),
    cast: people(i + 80, 6),
    country: COUNTRIES[i % COUNTRIES.length]!,
    ...(rating >= 7.8 ? { awards: `Won ${1 + (i % 3)} awards & ${4 + (i % 9)} nominations.` } : {}),
  };
}

function series([name, year, genres, rating, minutes, blurb, seasons, ongoing]: (typeof SERIES)[number], i: number): Meta {
  const id = `tt${9200001 + i}`;
  const videos: Video[] = [];
  const perSeason = 6 + (i % 5);
  // Ongoing shows' latest season is airing weekly: two episodes left, the next one a few days away.
  const lastAired = ongoing ? NOW - (2 + (i % 4)) * DAY : Date.UTC(year + seasons - 1, 10, 1);
  for (let s = 1; s <= seasons; s++) {
    for (let e = 1; e <= perSeason; e++) {
      const fromEnd = (seasons - s) * perSeason + (perSeason - e) - (ongoing ? 2 : 0);
      const released = s === seasons || ongoing ? lastAired - fromEnd * 7 * DAY : Date.UTC(year + s - 1, 8, 1 + e * 7);
      const title = e === 1 && s === 1 ? 'Pilot' : EPISODE_WORDS[1 + ((e + s * 3 + i) % (EPISODE_WORDS.length - 1))]!;
      videos.push({
        id: `${id}:${s}:${e}`,
        title,
        season: s,
        episode: e,
        released: new Date(released).toISOString(),
        thumbnail: art('still', `${name} s${s}e${e}`),
        overview: `${title}: ${blurb.split(' ').slice(0, 10).join(' ')}… and nothing will be the same after episode ${e}.`,
      });
    }
  }
  const end = ongoing ? '' : String(year + seasons - 1);
  return {
    id,
    type: 'series',
    name,
    poster: art('poster', name),
    background: art('background', name),
    logo: art('logo', name),
    description: blurb,
    releaseInfo: `${year}–${end}`,
    imdbRating: rating.toFixed(1),
    runtime: `${minutes} min`,
    genres,
    released: new Date(Date.UTC(year, 8, 8)).toISOString(),
    director: [],
    writer: people(i + 120, 2),
    cast: people(i + 160, 6),
    country: COUNTRIES[(i + 3) % COUNTRIES.length]!,
    status: ongoing ? 'Continuing' : 'Ended',
    videos,
  };
}

export const movies: Meta[] = MOVIES.map(movie);
export const shows: Meta[] = SERIES.map(series);
export const allTitles: Meta[] = [...movies, ...shows];
export const byId = new Map(allTitles.map((m) => [m.id, m]));
export const byName = (name: string) => allTitles.find((m) => m.name === name);

/**
 * `odd-titles` (app-fixture.ts): titles with the gaps real catalogs have, first in Cinemeta's Popular and in its
 * search. Not on TMDB, so its commands don't know them. Each leaves out what its name says.
 */
type OddMeta = Pick<Meta, 'id' | 'type' | 'name'> & Partial<Omit<Meta, 'videos'>> & { videos?: Partial<Video>[] };
const LONG_NAME = 'The Extraordinarily Long and Winding Chronicle of the Lighthouse Keeper Who Counted Every Single Wave That Broke Against the Northern Cliffs';
export const oddTitles: OddMeta[] = [
  // Nothing but its name.
  { id: 'tt9300001', type: 'movie', name: 'Nameplate Only' },
  { id: 'tt9300002', type: 'movie', name: LONG_NAME, poster: art('poster', 'long'), description: `${LONG_NAME}. `.repeat(6).trim(), releaseInfo: '2023', runtime: '201 min', genres: ['Drama', 'Adventure', 'History', 'Mystery'], imdbRating: '6.1' },
  { id: 'tt9300003', type: 'movie', name: 'SupercalifragilisticexpialidociousDirectorsCutExtendedRemasteredEdition', releaseInfo: '2022' },
  { id: 'tt9300004', type: 'movie', name: 'الطريق إلى البحر الأبيض', description: 'صياد عجوز يعود إلى قريته الساحلية بعد ثلاثين عامًا ليجد أن البحر قد تغيّر، وأن أبناءه لم يعودوا يعرفونه.', releaseInfo: '2021', genres: ['دراما'], runtime: '104 min', imdbRating: '7.3' },
  { id: 'tt9300005', type: 'movie', name: '千と千尋の長い長い夏休み物語', description: '田舎の祖母の家で夏を過ごす少女が、古い井戸の向こうに不思議な町を見つける。', releaseInfo: '2020', genres: ['アニメ', 'ファンタジー'] },
  // Shows: no episodes at all; episodes with nothing but their numbers (and a season with none between); specials only.
  { id: 'tt9300011', type: 'series', name: 'Announced, Not Aired', description: 'A show its addon lists before any episode is out.', releaseInfo: '2026–', videos: [] },
  {
    id: 'tt9300012',
    type: 'series',
    name: 'Bare Episodes',
    releaseInfo: '2015–2019',
    videos: [1, 3].flatMap((season) => [1, 2, 3].map((episode) => ({ id: `tt9300012:${season}:${episode}`, season, episode }))),
  },
  { id: 'tt9300013', type: 'series', name: 'Specials Only', background: art('background', 'Specials Only'), videos: [1, 2].map((episode) => ({ id: `tt9300013:0:${episode}`, season: 0, episode, title: `Special ${episode}` })) },
];
const oddById = new Map(oddTitles.map((m) => [m.id, m]));
let oddOn = false;
/** Puts the odd titles in Cinemeta's answers (the fixture's `odd-titles`). */
export function addOddTitles(): void {
  oddOn = true;
}
/** A sample title by id or name, odd ones included once they're on. */
export const findTitle = (idOrName: string): Meta | OddMeta | undefined =>
  byId.get(idOrName) ?? byName(idOrName) ?? (oddOn ? (oddById.get(idOrName) ?? oddTitles.find((m) => m.name === idOrName)) : undefined);

/** A catalog preview: what Cinemeta's catalogs send (no cast or episodes). */
export function preview(m: Meta | OddMeta) {
  return { id: m.id, type: m.type, name: m.name, poster: m.poster, background: m.background, logo: m.logo, description: m.description, releaseInfo: m.releaseInfo, imdbRating: m.imdbRating, runtime: m.runtime, genres: m.genres };
}

/** The display copy My Library, history and lists keep (library/snapshot.ts). */
export const snapshot = (m: Meta) => ({ meta: preview(m), origins: [{ key: 'cinemeta', name: 'Cinemeta' }] });

const t = (name: string) => byName(name)!;

// ── Addons ──

const GENRES = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
const YEARS = Array.from({ length: 6 }, (_, i) => String(2024 - i));
const browse = [{ name: 'genre', options: GENRES }, { name: 'skip' }];

const cinemeta = {
  id: 'com.linvo.cinemeta',
  version: '3.0.13',
  name: 'Cinemeta',
  description: 'The official addon for movie and series catalogs',
  types: ['movie', 'series'],
  resources: ['catalog', 'meta', 'addon_catalog'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'top', name: 'Popular', extra: [...browse, { name: 'search' }] },
    { type: 'series', id: 'top', name: 'Popular', extra: [...browse, { name: 'search' }] },
    { type: 'movie', id: 'year', name: 'New', extra: [{ name: 'genre', options: YEARS, isRequired: true }, { name: 'skip' }] },
    { type: 'series', id: 'year', name: 'New', extra: [{ name: 'genre', options: YEARS, isRequired: true }, { name: 'skip' }] },
    { type: 'movie', id: 'imdbRating', name: 'Featured', extra: browse },
    { type: 'series', id: 'imdbRating', name: 'Featured', extra: browse },
  ],
  behaviorHints: { configurable: false },
};

const subtitles = {
  id: 'org.stremio.opensubtitlesv3',
  version: '1.0.0',
  name: 'OpenSubtitles v3',
  description: 'OpenSubtitles v3 Addon for Stremio',
  types: ['movie', 'series'],
  resources: ['subtitles'],
  idPrefixes: ['tt'],
  catalogs: [],
};

const streams = {
  id: 'org.orbit.sample-streams',
  version: '1.2.0',
  name: 'Sample Streams',
  description: 'Streams for the layout tests (nothing real).',
  types: ['movie', 'series'],
  resources: ['stream'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: { configurable: true },
};

const archive = {
  id: 'org.orbit.film-archive',
  version: '0.9.4',
  name: 'Film Archive',
  description: 'Classic and documentary catalogs.',
  types: ['movie'],
  resources: ['catalog'],
  catalogs: [{ type: 'movie', id: 'docs', name: 'Documentaries', extra: [{ name: 'skip' }] }],
};

export const installedAddon = (key: string, manifest: object, host: string, builtIn: boolean, at: number) => ({
  key,
  manifest,
  displayHost: host,
  enabled: true,
  installedAt: at,
  urlReadable: true,
  builtIn,
  owned: !builtIn,
  shared: false,
  sharedBy: null,
});

export const addons = [
  installedAddon('cinemeta', cinemeta, 'v3-cinemeta.strem.io', true, NOW - 200 * DAY),
  installedAddon('opensubtitles', subtitles, 'opensubtitles-v3.strem.io', true, NOW - 200 * DAY),
  installedAddon('sample-streams', streams, 'streams.orbit.test', false, NOW - 120 * DAY),
  installedAddon('film-archive', archive, 'archive.orbit.test', false, NOW - 30 * DAY),
];

/**
 * The manifest an addon address answers (addon_fetch_manifest): an installed sample addon's own at its host,
 * otherwise a small catalog addon named after the host. A path with `/configure-me/` needs setting up first.
 */
export function manifestAt(url: URL): object {
  const own = { 'streams.orbit.test': streams, 'archive.orbit.test': archive }[url.host];
  if (own) return own;
  const name = url.hostname.split('.')[0]!.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => `${dash ? ' ' : ''}${c.toUpperCase()}`);
  return {
    id: `org.example.${url.hostname}`,
    version: '1.0.0',
    name,
    description: `Films from ${url.hostname} (made up for the layout tests).`,
    types: ['movie'],
    resources: ['catalog'],
    catalogs: [{ type: 'movie', id: 'top', name: 'Top' }],
    behaviorHints: { configurable: true, configurationRequired: url.pathname.includes('/configure-me/') },
  };
}

/** `/{resource}/{type}/{id}[/{extra}].json`, as addons/request.ts builds it. */
function parsePath(path: string) {
  const [, resource = '', type = '', id = '', extra = ''] = /^\/([^/]+)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path) ?? [];
  const args = new Map(extra.split('&').filter(Boolean).map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]));
  return { resource, type: decodeURIComponent(type), id: decodeURIComponent(id), args };
}

const PAGE = 100;

/** An addon's answer to `path` (the JSON text Rust would hand over), or null when it has none. */
export function addonAnswer(key: string, path: string): unknown {
  const { resource, type, id, args } = parsePath(path);
  const skip = Number(args.get('skip') ?? 0);
  const page = (list: Meta[]) => ({ metas: list.slice(skip, skip + PAGE).map(preview) });
  if (key === 'cinemeta') {
    const ofType = allTitles.filter((m) => m.type === type);
    const odd = oddOn ? oddTitles.filter((m) => m.type === type) : [];
    if (resource === 'catalog') {
      const search = args.get('search')?.toLowerCase();
      if (search) return { metas: [...odd, ...ofType].filter((m) => m.name.toLowerCase().includes(search) || (m.cast ?? []).some((c) => c.toLowerCase().includes(search))).map(preview) };
      const genre = args.get('genre');
      if (id === 'year') return page(ofType.filter((m) => m.releaseInfo.startsWith(genre ?? '')));
      const list = genre ? ofType.filter((m) => m.genres.includes(genre)) : ofType;
      if (id === 'top' && !genre) return { metas: [...(skip ? [] : odd), ...list.slice(skip, skip + PAGE)].map(preview) };
      return page(id === 'imdbRating' ? [...list].sort((a, b) => Number(b.imdbRating) - Number(a.imdbRating)) : list);
    }
    if (resource === 'meta') return { meta: byId.get(id) ?? (oddOn ? oddById.get(id) : null) ?? null };
    if (resource === 'addon_catalog') return { addons: [] };
  }
  if (key === 'film-archive' && resource === 'catalog') return page(movies.filter((m) => m.genres.includes('Documentary') || m.genres.includes('History')));
  if (key === 'sample-streams' && resource === 'stream') {
    const name = byId.get(id.split(':')[0]!)?.name ?? 'Video';
    const file = `${slug(name)}${id.includes(':') ? `.${id.split(':').slice(1).map((n) => n.padStart(2, '0')).join('x')}` : ''}`;
    const stream = (quality: string, codec: string, size: number, extra: string) => ({
      url: `https://streams.orbit.test/${file}.${quality}.mkv`,
      name: `Sample\n${quality}`,
      description: `${name} ${quality} ${codec} ${extra}\n💾 ${(size / 1e9).toFixed(1)} GB`,
      behaviorHints: { filename: `${file}.${quality}.${codec}.mkv`, videoSize: size, bingeGroup: `sample-${quality}` },
    });
    return {
      streams: [
        stream('2160p', 'HEVC', 18.4e9, 'HDR10 DDP5.1 Atmos'),
        stream('1080p', 'x265', 4.2e9, 'WEB-DL DDP5.1'),
        stream('1080p', 'x264', 9.8e9, 'BluRay DTS'),
        stream('720p', 'x264', 1.6e9, 'WEBRip AAC'),
      ],
    };
  }
  if (key === 'opensubtitles' && resource === 'subtitles') {
    return { subtitles: ['eng', 'spa', 'fre', 'ger'].map((lang, i) => ({ id: `${i}`, url: `https://subs.orbit.test/${id}.${lang}.srt`, lang })) };
  }
  return null;
}

/**
 * The fixture's `streams=<kind>`: Sample Streams answers oddly, as real addons do.
 * - `odd`: no name or description, a torrent only (infoHash), an emoji-heavy name, a very long description and
 *   filename, and entries Orbit drops (no address, YouTube, an external link, not an object).
 * - `many`: 300 sources of every quality.
 * - `torrents`: only torrents (hidden while Settings → Playback has torrents off).
 * - `unplayable`: only entries Orbit drops, so nothing can be played.
 */
export function streamVariant(kind: string, path: string): unknown {
  const { id } = parsePath(path);
  const name = byId.get(id.split(':')[0]!)?.name ?? 'Video';
  const file = slug(name);
  const hash = (n: number) => n.toString(16).padStart(40, 'a');
  switch (kind) {
    case 'odd':
      return {
        streams: [
          { url: `https://streams.orbit.test/${file}.nameless.mkv` },
          { url: `https://streams.orbit.test/${file}.1080p.mkv`, name: '🔥🔥 ⚡ TOP 🎬 1080p 🇬🇧🇫🇷🇩🇪🇪🇸🇮🇹 👍', description: '💾 2.1 GB 👤 412 ⚙️ Sample 🍿🍿🍿' },
          { infoHash: hash(1), fileIdx: 0, name: 'Torrent\n2160p', title: `${name}.2160p.REMUX.mkv\n👤 88 💾 61 GB` },
          {
            url: `https://streams.orbit.test/${file}.long.mkv`,
            name: 'Sample\n720p',
            description: `${name} 720p ${'Very.Long.Release.Group.Name.With.Many.Tags.'.repeat(60)}`,
            behaviorHints: { filename: `${file}.${'extended.directors.cut.remastered.'.repeat(8)}720p.x264.mkv` },
          },
          { name: 'No address' },
          { ytId: 'dQw4w9WgXcQ', name: 'Trailer' },
          { externalUrl: 'https://example.com/watch', name: 'Watch on the web' },
          'not a stream',
        ],
      };
    case 'many': {
      const qualities = ['2160p', '1080p', '720p', '480p'];
      return {
        streams: Array.from({ length: 300 }, (_, i) => ({
          url: `https://streams.orbit.test/${file}.${i}.mkv`,
          name: `Sample ${i + 1}\n${qualities[i % 4]}`,
          description: `${name} ${qualities[i % 4]} WEB-DL\n💾 ${(0.7 + (i % 37) * 0.6).toFixed(1)} GB`,
        })),
      };
    }
    case 'torrents':
      return { streams: ['2160p', '1080p', '720p'].map((quality, i) => ({ infoHash: hash(i + 1), name: `Torrent\n${quality}`, title: `${name}.${quality}.mkv` })) };
    case 'unplayable':
      return { streams: [{ name: 'No address' }, { ytId: 'dQw4w9WgXcQ' }, { externalUrl: 'https://example.com/watch' }, { url: 'ftp://streams.orbit.test/a.mkv' }] };
    default:
      throw new Error(`Unknown streams kind "${kind}"`);
  }
}

// ── The profile's own things ──

const PROFILE_LIMIT = { level: 'off', allowUnrated: true, allowLiveTv: true };
export type Profile = { id: string; name: string; color: string; avatar: string | null; addonsFrom: string | null; hasPin: boolean; contentLimit: typeof PROFILE_LIMIT };
export const profiles: Profile[] = [
  { id: 'main', name: 'Sam', color: '#e5484d', avatar: null, addonsFrom: null, hasPin: false, contentLimit: PROFILE_LIMIT },
  { id: 'kids', name: 'Kids', color: '#3e9bff', avatar: null, addonsFrom: 'main', hasPin: false, contentLimit: { level: 'kids', allowUnrated: false, allowLiveTv: false } },
];

const saved = ['The Weight of Snow', 'Echoes of Tomorrow', 'Blackwater County', 'Iron Orchard', 'Dragonlight', 'The Archivist', 'Small Mercies', 'The Inheritance', 'A Year in Kyoto', 'Hollow Crown Chronicles'];
export const library = saved.map((name, i) => ({ id: t(name).id, addedAt: NOW - (i * 3 + 1) * DAY, title: snapshot(t(name)) }));

/** Continue Watching: films part-watched, shows mid-episode or with the next one up. */
export function watchList() {
  const progress: object[] = [];
  const titles: object[] = [];
  const film = (name: string, part: number, daysAgo: number) => {
    const m = t(name);
    const duration = parseInt(m.runtime, 10) * 60;
    progress.push({ videoId: m.id, titleId: m.id, season: null, episode: null, position: Math.round(duration * part), duration, watched: part >= 0.9, updatedAt: NOW - daysAgo * DAY });
    titles.push({ titleId: m.id, title: snapshot(m), next: null, completed: part >= 0.9, updatedAt: NOW - daysAgo * DAY });
  };
  const show = (name: string, season: number, episode: number, part: number, hoursAgo: number) => {
    const m = t(name);
    const updatedAt = NOW - hoursAgo * 3_600_000;
    const duration = parseInt(m.runtime, 10) * 60;
    for (const v of m.videos!) {
      if (v.season < season || (v.season === season && v.episode < episode)) progress.push({ videoId: v.id, titleId: m.id, season: v.season, episode: v.episode, position: duration, duration, watched: true, updatedAt: updatedAt - 3_600_000 });
    }
    const at = m.videos!.find((v) => v.season === season && v.episode === episode)!;
    if (part > 0) progress.push({ videoId: at.id, titleId: m.id, season, episode, position: Math.round(duration * part), duration, watched: false, updatedAt });
    titles.push({ titleId: m.id, title: snapshot(m), next: { videoId: at.id, season, episode, title: at.title, thumbnail: at.thumbnail }, completed: false, updatedAt });
  };
  show('Blackwater County', 4, 3, 0.42, 3);
  film('Neon Meridian', 0.63, 1);
  show('The Orbital', 2, 5, 0, 20);
  film('The Last Harbor', 0.18, 2);
  show('Kitchen Confidential', 1, 4, 0.8, 50);
  film('Paper Lanterns', 0.35, 6);
  show('Office of Lost Things', 1, 2, 0.15, 30);
  // Watched to the end: history and stats, not Continue Watching.
  film('Iron Orchard', 1, 12);
  film('Small Mercies', 1, 20);
  film('Dust Over Calder', 1, 26);
  return { titles, progress };
}

const list = (id: string, name: string, description: string, days: number, names: string[]) => ({
  id,
  name,
  description,
  createdAt: NOW - days * DAY,
  items: names.map((n, i) => ({ titleId: t(n).id, addedAt: NOW - (days - i) * DAY, title: snapshot(t(n)) })),
});
export const lists = [
  list('l1', 'Date night', 'Easy picks for two.', 40, ['Paper Lanterns', 'Wild Honey', 'The Long Weekend', 'Saltwater Hymns', 'Moonlight Diner']),
  list('l2', 'Halloween', '', 25, ['Hollow Pines', 'The Thirteenth Floor Down', 'Ghosts of Ward Street', 'Orbit of Ash']),
  list('l3', 'Watch with the kids', 'Nothing too scary.', 10, ['Starfall Academy', 'Little Planets', 'The Lighthouse Keeper’s Cat', 'Summer of the Comet', 'Dragonlight', 'Moonbase Kids']),
];

export const ratings = [
  { titleId: t('Iron Orchard').id, rating: 4.5, liked: true, note: 'That ending.', updatedAt: NOW - 12 * DAY },
  { titleId: t('Small Mercies').id, rating: 4, liked: true, note: null, updatedAt: NOW - 20 * DAY },
  { titleId: t('Dust Over Calder').id, rating: 3, liked: false, note: null, updatedAt: NOW - 26 * DAY },
];

export const favouriteEpisodes = [
  (() => {
    const m = t('Blackwater County');
    const v = m.videos!.find((x) => x.season === 2 && x.episode === 4)!;
    return { seriesId: m.id, season: 2, episode: 4, videoId: v.id, title: v.title, still: v.thumbnail, show: snapshot(m), addedAt: NOW - 9 * DAY };
  })(),
];

export const collections = [
  {
    id: 'c0ffee0000000001',
    name: 'Cosy nights',
    group: null,
    art: {},
    sources: [],
    createdAt: NOW - 15 * DAY,
    items: ['Paper Lanterns', 'A Year in Kyoto', 'Kites Over Kabul Street', 'The Lighthouse Keeper’s Cat'].map((n) => ({ titleId: t(n).id, title: snapshot(t(n)) })),
  },
];

const download = (id: string, name: string, state: string, done: number, total: number, hoursAgo: number) => {
  const m = t(name);
  return {
    id,
    titleId: m.id,
    videoId: m.id,
    title: snapshot(m),
    season: null,
    episode: null,
    episodeTitle: null,
    label: '1080p · x265 · 4.2 GB',
    addonKey: 'sample-streams',
    streamType: 'movie',
    streamId: m.id,
    identity: `${id}-identity`,
    torrent: false,
    state,
    error: null,
    doneBytes: done,
    totalBytes: total,
    createdAt: NOW - hoursAgo * 3_600_000,
    finishedAt: state === 'done' ? NOW - (hoursAgo - 1) * 3_600_000 : null,
  };
};
export const downloads = [download('d1', 'The Archivist', 'done', 4.2e9, 4.2e9, 30), download('d2', 'Echoes of Tomorrow', 'running', 1.7e9, 4.4e9, 1)];

// ── Live TV ──

export const tvSources = [
  { id: 'tv1', name: 'Home IPTV', kind: 'xtream', host: 'tv.orbit.test', insecure: false, channels: 8, useVod: false, channelsAt: NOW - 3_600_000, epgAt: NOW - 3_600_000, epgError: null, account: { status: 'active', expires: Math.round((NOW + 120 * DAY) / 1000), maxConnections: 2, activeConnections: 0, trial: false, checkedAt: NOW - 3_600_000 } },
];

const CHANNELS: [name: string, group: string, shows: string[]][] = [
  ['Orbit News 24', 'News', ['World Tonight', 'Market Watch', 'The Briefing', 'Weather Now']],
  ['Harbour One', 'Entertainment', ['Harbour Lights', 'Quiz Masters', 'Village Vets', 'Late Laughs']],
  ['Cinema Classics', 'Movies', ['Iron Orchard', 'Dust Over Calder', 'Glass Monarch', 'Tides of War']],
  ['Kids Planet', 'Kids', ['Little Planets', 'Moonbase Kids', 'Dragonlight', 'Starfall Academy']],
  ['Sport Arena', 'Sport', ['Matchday Live', 'The Long Game', 'Goals Tonight', 'Fight Night']],
  ['Discovery Lane', 'Documentary', ['A Year in Kyoto', 'Cold Case Unit', 'Wild Coasts', 'Thunder Road Reunion']],
  ['Crime Channel', 'Entertainment', ['Northside Precinct', 'Blackwater County', 'Deep Cover', 'Cold Case Unit']],
  ['Music Box', 'Music', ['Top 40 Countdown', 'Unplugged', 'Thunder Road Reunion', 'Night Grooves']],
];

export const tvChannels = CHANNELS.map(([name, group], i) => ({
  source: 'tv1',
  key: `ch${i + 1}`,
  name,
  logo: art('channel', name),
  group,
  favourite: i < 3,
  rank: i < 3 ? i : null,
  listed: true,
  archive: i % 3 === 0 ? 3 : 0,
}));

/** Each channel's programmes, an hour each from six hours ago (half-hour offsets on odd channels). */
export function tvProgrammes(key: string, from: number, to: number) {
  const index = Number(key.slice(2)) - 1;
  const shows = CHANNELS[index]?.[2] ?? [];
  // A channel of `tv-many` (app-fixture.ts): no guide.
  if (!shows.length) return [];
  const hour = 3600;
  const now = Math.floor(NOW / 1000);
  const start0 = Math.floor(now / hour) * hour - 6 * hour + (index % 2) * 1800;
  const out: { title: string; start: number; stop: number; description: string | null }[] = [];
  for (let start = start0, n = 0; start < now + 30 * hour; start += hour, n++) {
    const title = shows[(n + index) % shows.length]!;
    if (start + hour > from && start < to) out.push({ title, start, stop: start + hour, description: byName(title)?.description ?? `${title}, live from the studio.` });
  }
  return out;
}

export function tvGuide(channels: [string, string][]) {
  const now = Math.floor(NOW / 1000);
  return channels.map(([source, key]) => {
    const list = tvProgrammes(key, now - 3600, now + 7200);
    const at = list.findIndex((p) => p.start <= now && p.stop > now);
    return { source, key, now: list[at] ?? null, next: list[at + 1] ?? null };
  });
}

export const tvGroups = {
  groups: [...new Set(CHANNELS.map((c) => c[1]))].map((name) => ({ name, count: CHANNELS.filter((c) => c[1] === name).length, hidden: false, locked: false })),
  unlocked: false,
  pinSet: false,
};

// ── TMDB (a token is saved) ──

const tmdbTitle = (m: Meta) => ({
  imdbId: m.id,
  kind: m.type,
  name: m.name,
  poster: tmdbArt('poster', m.name),
  background: tmdbArt('background', m.name),
  year: m.releaseInfo.slice(0, 4),
  overview: m.description,
  released: m.released.slice(0, 10),
  rating: Number(m.imdbRating),
});
export const tmdbTitles = (list: Meta[]) => list.map(tmdbTitle);
/** A title's TMDB id (as `tmdb_extras` gives it). */
export const tmdbId = (m: Meta) => Number(m.id.slice(2)) - 9_000_000;
/** TMDB search hits (the avatar picker's titles). */
export const titleHits = (list: Meta[]) =>
  list.map((m) => ({ id: tmdbId(m), kind: m.type, name: m.name, year: m.releaseInfo.slice(0, 4), poster: tmdbArt('poster', m.name), imdbId: m.id, animated: m.genres.includes('Animation') }));

/** TMDB's genre ids (films and shows) as Cinemeta names them. */
const TMDB_GENRES: Record<string, string[]> = {
  '28': ['Action'], '12': ['Adventure'], '10759': ['Action', 'Adventure'], '16': ['Animation'], '35': ['Comedy'], '80': ['Crime'], '99': ['Documentary'],
  '18': ['Drama'], '10751': ['Family'], '14': ['Fantasy'], '10765': ['Sci-Fi', 'Fantasy'], '36': ['History'], '27': ['Horror'], '10402': ['Music'],
  '9648': ['Mystery'], '10749': ['Romance'], '878': ['Sci-Fi'], '53': ['Thriller'], '10752': ['War'], '10768': ['War'], '37': ['Western'],
};
const ANIME_KEYWORD = '210024';

/** TMDB's discover (and the other collection sources) over the sample titles: media, genres, the anime keyword and the sort. */
export function tmdbDiscover(source: { media?: string; sort?: string | null; filters?: Record<string, unknown> }): Meta[] {
  let list = source.media === 'tv' ? shows : source.media === 'movie' ? movies : allTitles;
  const filters = source.filters ?? {};
  if (String(filters.withKeywords ?? '').split(/[,|]/).includes(ANIME_KEYWORD)) list = list.filter((m) => ANIME.has(m.name));
  const genres = String(filters.withGenres ?? '').split(',').filter(Boolean);
  if (genres.length) {
    // Comma: every genre; a "|" inside one: any of them.
    const narrowed = list.filter((m) => genres.every((g) => g.split('|').some((id) => (TMDB_GENRES[id] ?? []).some((name) => m.genres.includes(name)))));
    if (narrowed.length) list = narrowed;
  }
  // Release windows (In cinemas, Upcoming, Airing this week): kept to titles out (or airing) in them, when any are.
  const from = String(filters.regionReleaseDateGte ?? filters.primaryReleaseDateGte ?? filters.airDateGte ?? '');
  const to = String(filters.regionReleaseDateLte ?? filters.primaryReleaseDateLte ?? filters.airDateLte ?? '9999');
  if (from) {
    const inWindow = (date: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= to;
    const dated = list.filter((m) => inWindow(m.released) || (m.videos ?? []).some((v) => inWindow(v.released)));
    if (dated.length) list = dated;
  }
  const sort = source.sort ?? '';
  if (sort.startsWith('vote_average')) return [...list].sort((a, b) => Number(b.imdbRating) - Number(a.imdbRating));
  if (/date/.test(sort)) return [...list].sort((a, b) => b.released.localeCompare(a.released));
  return mix(list, 19);
}
/** A stable shuffle, so TMDB's lists differ from Cinemeta's order. */
export const mix = (list: Meta[], seed: number) => [...list].sort((a, b) => ((Number(a.id.slice(2)) * seed) % 97) - ((Number(b.id.slice(2)) * seed) % 97));

export const services = [
  ['netflix', 'Netflix'],
  ['prime', 'Prime Video'],
  ['disney', 'Disney+'],
  ['max', 'Max'],
  ['apple', 'Apple TV+'],
  ['hulu', 'Hulu'],
].map(([key, name]) => ({ key: key!, name: name!, logo: tmdbArt('provider', name!) }));

/** A US certificate that fits the title's genres. */
export function certification(id: string): string {
  const m = byId.get(id);
  if (!m) return '';
  const kids = m.genres.includes('Animation') || m.genres.includes('Family');
  const hard = ['Horror', 'Crime', 'War', 'Thriller'].some((g) => m.genres.includes(g));
  if (m.type === 'series') return kids ? 'TV-Y7' : hard ? 'TV-MA' : 'TV-14';
  return kids ? 'PG' : hard ? 'R' : 'PG-13';
}

export const cast = (m: Meta) => m.cast.map((name, i) => ({ id: 1000 + Number(m.id.slice(2)) * 10 + i, name, character: i === 0 ? 'Lead' : `${['Detective', 'Captain', 'Doctor', 'Mayor', 'Professor'][i % 5]} ${LAST[(i * 3) % LAST.length]}`, photo: tmdbArt('face', name) }));

export { iso };
