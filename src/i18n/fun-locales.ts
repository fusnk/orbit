/**
 * Joke languages (Settings → Appearance → Little extras → Fun languages):
 * Pirate, UwU, Elder Futhark runes and Upside down. Nobody translates them:
 * each string is made from its English one when it's first shown, by the pure
 * functions here.
 *
 * Only prose changes. Placeholders (`{name}`), tags, links, file extensions,
 * key names, acronyms and brand names pass through untouched, so filled-in
 * values, shortcuts and names stay readable and correct. Where a touch is
 * "occasional" (a pirate's "Arr!", an uwu stutter) it's picked from a hash of
 * the key, not at random, so a string reads the same every time it's drawn.
 */

export const FUN_LANGUAGES = [
  { id: 'x-pirate', name: 'funlangs.pirate' },
  { id: 'x-uwu', name: 'funlangs.uwu' },
  { id: 'x-futhark', name: 'funlangs.futhark' },
  { id: 'x-upside-down', name: 'funlangs.upside-down' },
] as const;
export type FunLanguageId = (typeof FUN_LANGUAGES)[number]['id'];

export const isFunLanguage = (v: unknown): v is FunLanguageId => FUN_LANGUAGES.some((l) => l.id === v);

/** Names kept as they're written: products, services, fonts and platforms Orbit mentions. */
export const BRANDS = [
  'Orbit',
  'Stremio',
  'TMDB',
  'IMDb',
  'Trakt',
  'Jellyfin',
  'Plex',
  'RPDB',
  'AniList',
  'Kitsu',
  'MyAnimeList',
  'Simkl',
  'Letterboxd',
  'Cinemeta',
  'Nuvio',
  'TorBox',
  'Real-Debrid',
  'AllDebrid',
  'Premiumize',
  'Debrid-Link',
  'OpenAI',
  'Gemini',
  'Anthropic',
  'Claude',
  'Ollama',
  'LM Studio',
  'Discord',
  'JustWatch',
  'Rotten Tomatoes',
  'TheIntroDB',
  'AniSkip',
  'GitHub',
  'TVmaze',
  'TheTVDB',
  'Wikidata',
  'Wikipedia',
  'YouTube',
  'Xtream',
  'Dolby',
  'Windows',
  'macOS',
  'Linux',
  'Android',
  'Rust',
  'WebVTT',
  'WebP',
  'Wi-Fi',
  'OpenDyslexic',
  'Lexend',
  'Atkinson Hyperlegible',
  'Montserrat',
  'Nord',
  'Ghibli',
  'mpv',
  'ffmpeg',
  'libmpv',
] as const;

/** Keys whose whole string is a key's name (Settings → Shortcuts), kept in English. */
const KEY_NAME_KEYS = /^settings\.keys\.|^settings\.shortcuts\.[\w-]*-keys$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Everything that must pass through unchanged, in one pattern. */
const FROZEN = new RegExp(
  [
    // Placeholders, and anything tag-like.
    String.raw`\{[^}]*\}`,
    String.raw`<[^>]*>`,
    // Links (without a sentence's closing punctuation), web addresses and IPs.
    String.raw`[a-z][a-z0-9+.-]*:\/\/(?:[^\s'"]*[^\s'".,;:)])?`,
    String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|tv|app|dev|co)\b`,
    // File extensions (".srt").
    String.raw`(?<![\w.])\.[a-z0-9]{2,5}\b`,
    // Key names and combinations (Ctrl+K, Shift+H, Esc, F11).
    String.raw`\b(?:Ctrl|Shift|Alt|Cmd|Esc|Enter|Backspace|PageUp|PageDown|F\d{1,2})(?:\+\w+)*\b`,
    String.raw`\b\w\+\w\b`,
    // Brands, longest first so "LM Studio" wins over a shorter overlap.
    ...[...BRANDS].sort((a, b) => b.length - a.length).map((b) => String.raw`(?<![\w-])${escape(b)}(?![\w-])`),
    // Acronyms and codes (HDR, 4K, TVs, TV-MA), and a letter stuck to a placeholder (S{season}E{episode}).
    String.raw`\b(?:[A-Z][A-Z0-9]+|\d+[A-Z][A-Z0-9]*)(?:-[A-Z0-9]+)*s?\b`,
    String.raw`\b[A-Z](?=\{)|(?<=\})[A-Z]\b`,
  ].join('|'),
  'g',
);

interface Segment {
  text: string;
  frozen: boolean;
}

/** `text` split into prose (which a transform may change) and frozen parts. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(FROZEN)) {
    if (match.index > at) out.push({ text: text.slice(at, match.index), frozen: false });
    out.push({ text: match[0], frozen: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), frozen: false });
  return out;
}

/** A small, stable hash (FNV-1a) of a key, for the touches that only some strings get. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** `word` written in the case `like` is: "Ye" for "You", "YE" for "YOU". */
function matchCase(like: string, word: string): string {
  if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] !== like[0]!.toLowerCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/** Prose parts mapped by `change`; frozen parts as they were. */
const mapProse = (parts: Segment[], change: (text: string) => string) => parts.map((p) => (p.frozen ? p : { text: change(p.text), frozen: false }));
const join = (parts: Segment[]) => parts.map((p) => p.text).join('');

// ── Pirate ──

const PIRATE_PHRASES: [RegExp, string][] = [
  [/\bsign in\b/gi, 'come aboard'],
  [/\bsigned in\b/gi, 'aboard'],
  [/\bsign out\b/gi, 'abandon ship'],
  [/\bthank you\b/gi, 'thank ye kindly'],
  [/\bis not\b/gi, 'be not'],
];

const PIRATE_WORDS: Record<string, string> = {
  you: 'ye',
  your: 'yer',
  yours: 'yers',
  "you're": 'ye be',
  "you've": 'ye’ve',
  "you'll": 'ye’ll',
  yourself: 'yerself',
  hello: 'ahoy',
  hi: 'ahoy',
  yes: 'aye',
  no: 'nay',
  my: 'me',
  is: 'be',
  are: 'be',
  am: 'be',
  "isn't": 'be not',
  "aren't": 'be not',
  the: 'th’',
  of: 'o’',
  for: 'fer',
  and: 'an’',
  with: 'wit’',
  over: 'o’er',
  never: 'ne’er',
  ever: 'e’er',
  there: 'thar',
  them: '’em',
  friend: 'matey',
  friends: 'hearties',
  people: 'crew',
  everyone: 'all hands',
  stop: 'avast',
  cancel: 'belay',
  wait: 'belay',
  error: 'blunder',
  errors: 'blunders',
  money: 'doubloons',
  library: 'treasure hold',
  save: 'stow',
  saved: 'stowed',
  delete: 'scuttle',
  deleted: 'scuttled',
  remove: 'scuttle',
  removed: 'scuttled',
  download: 'haul',
  downloads: 'hauls',
  downloaded: 'hauled',
  search: 'scour',
  searches: 'scours',
  find: 'hunt down',
  found: 'spotted',
  look: 'spy',
  looks: 'spies',
  see: 'spy',
  watch: 'spy',
  new: 'fresh',
  song: 'shanty',
  songs: 'shanties',
  music: 'shanties',
  stranger: 'scallywag',
  strangers: 'scallywags',
  quickly: 'smartly',
};

/** Words that end in "ing" but aren't a verb's "-ing" form. */
const NOT_ING = new Set(['thing', 'things', 'king', 'ring', 'sing', 'bring', 'string', 'strings', 'during', 'spring', 'evening', 'something', 'nothing', 'anything', 'everything', 'ceiling', 'wing', 'swing']);

function pirateWord(word: string): string {
  const lower = word.toLowerCase().replace(/’/g, "'");
  const swap = Object.hasOwn(PIRATE_WORDS, lower) ? PIRATE_WORDS[lower] : undefined;
  if (swap) return matchCase(word, swap);
  // "loading" → "loadin’"
  if (/^[a-z]{3,}ing$/i.test(word) && !NOT_ING.has(lower)) return `${word.slice(0, -1)}’`;
  return word;
}

const pirateProse = (text: string) => {
  let out = text;
  for (const [pattern, swap] of PIRATE_PHRASES) out = out.replace(pattern, (m) => matchCase(m, swap));
  return out.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, pirateWord);
};

const ARRS = [', arr!', ', yarr!', ' ahoy!'];
const SIGN_OFFS = [', matey.', ', savvy?', ', ye scallywag.'];

function pirate(key: string, text: string): string {
  const parts = mapProse(segments(text), pirateProse);
  const last = parts[parts.length - 1];
  if (last && !last.frozen) {
    const h = hash(key);
    const words = text.trim().split(/\s+/).length;
    // A short heading or label now and then gets an "Arr!"; a longer sentence a sign-off.
    if (words <= 3 && /[A-Za-z]$/.test(last.text) && /heading|title/.test(key.slice(key.lastIndexOf('.') + 1)) && h % 3 === 0) last.text += ARRS[(h >>> 4) % ARRS.length];
    else if (words >= 6 && /[a-z]\.$/.test(last.text) && h % 4 === 0) last.text = last.text.slice(0, -1) + SIGN_OFFS[(h >>> 4) % SIGN_OFFS.length];
  }
  return join(parts);
}

// ── UwU ──

const uwuProse = (text: string) =>
  text
    .replace(/ove\b/g, 'uv')
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiou])/g, 'Ny$1')
    .replace(/N([AEIOU])/g, 'NY$1');

const FACES = [' uwu', ' owo', ' >w<', ' ^w^', ' (◕ᴗ◕✿)', ' (˘ω˘)'];

function uwu(key: string, text: string): string {
  const parts = mapProse(segments(text), uwuProse);
  const h = hash(key);
  // A stutter on the first word of some strings: "H-Hewwo".
  const first = parts[0];
  if (first && !first.frozen && h % 5 === 0) first.text = first.text.replace(/^([A-Za-z])(?=[A-Za-z]{2})/, '$1-$1');
  // A face after some longer strings.
  const last = parts[parts.length - 1];
  if (last && !last.frozen && text.trim().split(/\s+/).length >= 4 && (h >>> 3) % 3 === 0) last.text += FACES[(h >>> 6) % FACES.length];
  return join(parts);
}

// ── Elder Futhark ──

const RUNES: Record<string, string> = {
  a: 'ᚨ',
  b: 'ᛒ',
  c: 'ᚲ',
  d: 'ᛞ',
  e: 'ᛖ',
  f: 'ᚠ',
  g: 'ᚷ',
  h: 'ᚺ',
  i: 'ᛁ',
  j: 'ᛃ',
  k: 'ᚲ',
  l: 'ᛚ',
  m: 'ᛗ',
  n: 'ᚾ',
  o: 'ᛟ',
  p: 'ᛈ',
  q: 'ᚲ',
  r: 'ᚱ',
  s: 'ᛊ',
  t: 'ᛏ',
  u: 'ᚢ',
  v: 'ᚹ',
  w: 'ᚹ',
  x: 'ᚲᛊ',
  y: 'ᛃ',
  z: 'ᛉ',
};

/** Runes have no case; "th" and "ng" have runes of their own. Digits and everything else stay. */
const futharkProse = (text: string) =>
  text
    .toLowerCase()
    .replace(/th/g, 'ᚦ')
    .replace(/ng/g, 'ᛜ')
    .replace(/[a-z]/g, (c) => RUNES[c]!);

const futhark = (_key: string, text: string) => join(mapProse(segments(text), futharkProse));

// ── Upside down ──

const FLIPPED: Record<string, string> = {
  a: 'ɐ',
  b: 'q',
  c: 'ɔ',
  d: 'p',
  e: 'ǝ',
  f: 'ɟ',
  g: 'ƃ',
  h: 'ɥ',
  i: 'ᴉ',
  j: 'ɾ',
  k: 'ʞ',
  m: 'ɯ',
  n: 'u',
  p: 'd',
  q: 'b',
  r: 'ɹ',
  t: 'ʇ',
  u: 'n',
  v: 'ʌ',
  w: 'ʍ',
  y: 'ʎ',
  A: '∀',
  C: 'Ɔ',
  E: 'Ǝ',
  F: 'Ⅎ',
  G: '⅁',
  J: 'ſ',
  L: '˥',
  M: 'W',
  P: 'Ԁ',
  R: 'ᴚ',
  T: '⊥',
  U: '∩',
  V: 'Λ',
  W: 'M',
  Y: '⅄',
  '.': '˙',
  ',': '\'',
  "'": ',',
  '’': ',',
  '‘': ',',
  '"': '„',
  '“': '„',
  '”': '„',
  '?': '¿',
  '!': '¡',
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '<': '>',
  '>': '<',
  '&': '⅋',
  _: '‾',
};

/**
 * The string turned half a turn: every character flipped and the order
 * reversed. Frozen parts keep their own order (a placeholder must stay
 * `{name}`), only their place in the string moves. Still read left to right.
 */
const upsideDown = (_key: string, text: string) =>
  segments(text)
    .reverse()
    .map((p) =>
      p.frozen
        ? p.text
        : Array.from(p.text)
            .reverse()
            .map((c) => FLIPPED[c] ?? c)
            .join(''),
    )
    .join('');

const TRANSFORMS: Record<FunLanguageId, (key: string, text: string) => string> = {
  'x-pirate': pirate,
  'x-uwu': uwu,
  'x-futhark': futhark,
  'x-upside-down': upsideDown,
};

/** `text` (the English string for `key`) in the joke language `id`. */
export function funText(id: FunLanguageId, key: string, text: string): string {
  if (KEY_NAME_KEYS.test(key)) return text;
  return TRANSFORMS[id](key, text);
}
