/**
 * Per-show audio and subtitle memory: the audio language and subtitle
 * choice picked by hand for a series (or movie), applied to its later
 * episodes ahead of the preferred languages in Settings. Choices are kept
 * by language and kind (off, forced, SDH), not track number, since every
 * episode's file numbers its tracks its own way.
 *
 * Kept per profile, for the 500 titles used most recently.
 */
import * as v from 'valibot';
import { languageKey, UNKNOWN_LANGUAGE } from '../../lib/languages';
import { profileStore } from './profile-store';
import { isAvoided, isSdh, type TrackInfo } from './tracks';

export const TRACK_MEMORY_PREFIX = 'player.track-memory';
export const MAX_REMEMBERED = 500;
const MAX_TITLE_ID = 100;
const MAX_BYTES = 60_000;

/** [title id, audio language or '', subtitle choice or '']: '' means not picked by hand. */
export type Remembered = [string, string, string];

const LANGUAGE = /^[A-Za-z0-9-]{2,20}$/;
/** 'off', or a language with an optional kind: 'en', 'en:forced', 'en:sdh'. */
const SUBTITLE = /^(off|[A-Za-z0-9-]{2,20}(:(forced|sdh))?)$/;

const EntrySchema = v.tuple([
  v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TITLE_ID)),
  v.union([v.literal(''), v.pipe(v.string(), v.regex(LANGUAGE))]),
  v.union([v.literal(''), v.pipe(v.string(), v.regex(SUBTITLE))]),
]);

/** Saved memory, oldest first, minus junk and empty entries. */
export function parseTrackMemory(value: unknown): Remembered[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: Remembered[] = [];
  // From the newest, so a duplicated title keeps its latest choice.
  for (const raw of [...value].reverse()) {
    const r = v.safeParse(EntrySchema, raw);
    if (!r.success || seen.has(r.output[0]) || (!r.output[1] && !r.output[2])) continue;
    seen.add(r.output[0]);
    entries.push(r.output as Remembered);
  }
  return entries.slice(0, MAX_REMEMBERED).reverse();
}

/**
 * Whether what plays keeps and follows the memory: movies and episodes, not
 * a live channel, a catch-up programme (its title is one past broadcast), a
 * trailer or a pasted link.
 */
export const remembersTracks = (playing: { live?: boolean | undefined; replay?: boolean | undefined; trailer?: boolean | undefined; link?: boolean | undefined }): boolean =>
  !playing.live && !playing.replay && !playing.trailer && !playing.link;

/** The choice remembered for a title, if any. */
export function choiceFor(entries: readonly Remembered[], titleId: string): { audio?: string; sub?: string } {
  const entry = entries.find(([id]) => id === titleId);
  if (!entry) return {};
  return { ...(entry[1] ? { audio: entry[1] } : {}), ...(entry[2] ? { sub: entry[2] } : {}) };
}

/** Notes a pick for a title, making it the most recent; the least recently used go past the cap. */
export function rememberChoice(entries: readonly Remembered[], titleId: string, which: 'audio' | 'sub', choice: string): Remembered[] {
  if (titleId.length > MAX_TITLE_ID || !(which === 'audio' ? LANGUAGE : SUBTITLE).test(choice)) return [...entries];
  const old = entries.find(([id]) => id === titleId) ?? [titleId, '', ''];
  const entry: Remembered = which === 'audio' ? [titleId, choice, old[2]] : [titleId, old[1], choice];
  const next = [...entries.filter(([id]) => id !== titleId), entry].slice(-MAX_REMEMBERED);
  // Settings hold 64 KB each; very long title ids could pass that before the cap.
  while (next.length > 1 && JSON.stringify(next).length > MAX_BYTES) next.shift();
  return next;
}

export const forgetChoice = (entries: readonly Remembered[], titleId: string): Remembered[] => entries.filter(([id]) => id !== titleId);

/**
 * What a subtitle is, as remembered: 'en', 'en:forced' or 'en:sdh' ('' if its language is unknown).
 * SDH as the subtitle list shows it (`isSdh`): by name, or flagged (`sdh`), as an addon marks one.
 */
export function subtitleChoice(lang: string | null | undefined, forced = false, title: string | null = null, sdh = false): string {
  const key = languageKey(lang);
  if (key === UNKNOWN_LANGUAGE) return '';
  return forced ? `${key}:forced` : isSdh(title, lang, sdh) ? `${key}:sdh` : key;
}

/**
 * The file's subtitle track for a remembered choice: the same language and
 * kind; otherwise (for a plain or SDH choice) the other of those two, never
 * a forced track for full subtitles, or the reverse.
 */
export function matchSubtitle(tracks: readonly TrackInfo[], choice: string): TrackInfo | undefined {
  const [lang, kind = ''] = choice.split(':');
  const subs = tracks.filter((t) => t.kind === 'sub' && languageKey(t.lang) === lang);
  const kindOf = (t: TrackInfo) => subtitleChoice(t.lang, t.forced, t.title, t.hearingImpaired).split(':')[1] ?? '';
  if (kind === 'forced') return subs.find((t) => kindOf(t) === 'forced');
  return subs.find((t) => kindOf(t) === kind) ?? subs.find((t) => kindOf(t) !== 'forced');
}

/**
 * A remembered forced choice only holds over audio in its language (or of
 * unknown language); over other audio (a dub) it means that language's full
 * subtitles: 'en:forced' with Japanese audio is 'en'.
 */
export function choiceForAudio(choice: string, audio: string): string {
  const [lang = '', kind] = choice.split(':');
  return kind === 'forced' && audio !== UNKNOWN_LANGUAGE && audio !== lang ? lang : choice;
}

/** The audio track in a remembered language, skipping ones named with avoided words (e.g. commentary). */
export function matchAudio(tracks: readonly TrackInfo[], lang: string, avoidWords: readonly string[]): TrackInfo | undefined {
  const audio = tracks.filter((t) => t.kind === 'audio' && languageKey(t.lang) === lang);
  return audio.find((t) => !isAvoided(t, avoidWords)) ?? audio[0];
}

/**
 * The language of the audio that plays: the remembered one when the file has
 * it (it's picked as the file starts), else the track selected now.
 */
export function playingAudio(tracks: readonly TrackInfo[], remembered: string | undefined, avoidWords: readonly string[]): string {
  const track = (remembered ? matchAudio(tracks, remembered, avoidWords) : undefined) ?? tracks.find((t) => t.kind === 'audio' && t.selected);
  return languageKey(track?.lang);
}

const store = profileStore(TRACK_MEMORY_PREFIX, parseTrackMemory);

export const trackMemory = {
  load: () => store.load(),
  /** The remembered choice for a title (empty until loaded). */
  get: (titleId: string) => choiceFor(store.get(), titleId),
  remember: (titleId: string, which: 'audio' | 'sub', choice: string) => void store.record((entries) => rememberChoice(entries, titleId, which, choice)),
  forget: (titleId: string) => void store.update((entries) => forgetChoice(entries, titleId)),
};
