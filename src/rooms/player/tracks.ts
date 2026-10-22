/**
 * Audio and subtitle choices for the Tracks panel, built from mpv's track
 * list plus subtitles offered by addons.
 */
import { t, type MessageKey } from '../../i18n';
import { languageKey, languageName, UNKNOWN_LANGUAGE } from '../../lib/languages';
import { BEST_MATCH_SCORE, bestMatch, releaseScore, subtitleRelease, type Release, type SubtitleRelease } from './subtitle-match';

/** A track as mpv reports it (see `Track` in src-tauri/src/player/mod.rs). */
export interface TrackInfo {
  id: number;
  kind: 'audio' | 'sub';
  title: string | null;
  lang: string | null;
  codec: string | null;
  channels: number | null;
  /** The main pick of its kind. */
  selected: boolean;
  /** Shown as the second subtitle, at the top. */
  secondary: boolean;
  external: boolean;
  default: boolean;
  forced: boolean;
  /** Flagged for the deaf and hard of hearing (mpv's `hearing-impaired`; absent from older reports). */
  hearingImpaired?: boolean;
}

/** A subtitle an addon offered; `title` is what it's called once added to mpv. */
export interface AddonSubtitle {
  url: string;
  lang: string;
  addon: string;
  title: string;
  /** Its number among this addon's offers for the language. */
  number: number;
  /** Its release name and details, for matching it to the file playing (see subtitle-match.ts). */
  release?: SubtitleRelease | undefined;
  /** Its release name to show, shortened (only from a file name the addon gave, never from an address; see `shortReleaseName`). */
  name?: string | undefined;
  /** Made for the deaf and hard of hearing, as its name says. */
  sdh?: boolean | undefined;
}

/** `sdh`: shows an "SDH" chip (subtitles that describe sounds as well). */
export type SubtitleOption = { kind: 'track'; track: TrackInfo; label: string; detail: string; sdh?: boolean } | { kind: 'addon'; sub: AddonSubtitle; label: string; detail: string; sdh?: boolean };

export interface SubtitleGroup {
  key: string;
  name: string;
  options: SubtitleOption[];
  selected: boolean;
}

/** Files the user added themselves; listed first. */
export const UPLOADED_GROUP = 'uploaded';

const CODECS: Record<string, string> = {
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: t('player.tracks.text'),
  hdmv_pgs_subtitle: t('player.tracks.image-codec', { codec: 'PGS' }),
  dvd_subtitle: t('player.tracks.image-codec', { codec: 'VobSub' }),
  dvb_subtitle: t('player.tracks.image-codec', { codec: 'DVB' }),
  eac3: 'E-AC-3',
  ac3: 'AC-3',
  aac: 'AAC',
  dts: 'DTS',
  truehd: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
};

const codecName = (codec: string | null) => (codec ? (CODECS[codec.toLowerCase()] ?? codec.toUpperCase()) : null);

function channelLayout(channels: number | null): string | null {
  if (!channels) return null;
  if (channels === 1) return t('player.tracks.mono');
  if (channels === 2) return t('player.tracks.stereo');
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return t('player.tracks.channels', { count: channels });
}

/** "English · E-AC-3 5.1" plus the track's own title when it adds something. */
export function audioLabel(track: TrackInfo): { label: string; detail: string } {
  const label = languageName(languageKey(track.lang));
  const detail = [track.title, codecName(track.codec), channelLayout(track.channels)].filter(Boolean).join(' · ');
  return { label, detail };
}

/** Words in a file or track name that mark subtitles for the deaf and hard of hearing. */
const SDH_WORDS = /(?:^|[^\p{L}\p{N}])(sdh|cc|hi|hearing[ ._-]?impaired|closed[ ._-]?captions?)(?=$|[^\p{L}\p{N}])/giu;

/**
 * Whether a subtitle's name (or its flag) says it's for the deaf and hard of
 * hearing. "hi" is also Hindi's code, so it doesn't count for Hindi ones.
 */
export function isSdh(name: string | null | undefined, lang: string | null | undefined, flagged = false): boolean {
  if (flagged) return true;
  const hindi = languageKey(lang) === 'hi';
  return [...(name ?? '').matchAll(SDH_WORDS)].some((m) => !(hindi && m[1]!.toLowerCase() === 'hi'));
}

function trackOption(track: TrackInfo): SubtitleOption {
  const flags = [track.forced ? t('player.tracks.forced') : null, track.default ? t('player.tracks.default') : null];
  const detail = [codecName(track.codec), ...flags].filter(Boolean).join(' · ');
  return { kind: 'track', track, label: track.title || (track.external ? t('player.tracks.added') : t('player.tracks.embedded')), detail, sdh: isSdh(track.title, track.lang, track.hearingImpaired) };
}

/**
 * Groups subtitles by language: the file's own tracks and files the user
 * added, then each addon's offers. An addon subtitle that has already been
 * added to mpv shows once, as its track.
 */
export function groupSubtitles(tracks: readonly TrackInfo[], offers: readonly AddonSubtitle[], preferred: readonly string[], best: ReadonlySet<string> = new Set(), video?: Release): SubtitleGroup[] {
  const groups = new Map<string, SubtitleGroup>();
  const group = (key: string, name: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, options: [], selected: false }));
    return g;
  };
  const offerByTitle = new Map(offers.map((o) => [o.title, o]));
  const added = new Set<string>();

  for (const track of tracks) {
    if (track.kind !== 'sub') continue;
    const offer = track.external ? offerByTitle.get(track.title ?? '') : undefined;
    let g: SubtitleGroup;
    let option = trackOption(track);
    if (offer) {
      added.add(offer.url);
      const key = languageKey(offer.lang);
      g = group(key, languageName(key));
      option = { ...option, label: offer.addon, detail: offerDetail(offer, best, video), sdh: !!offer.sdh || !!option.sdh };
    } else if (track.external) {
      g = group(UPLOADED_GROUP, t('player.tracks.your-files'));
    } else {
      const key = languageKey(track.lang);
      g = group(key, languageName(key));
    }
    g.options.push(option);
    if (track.selected) g.selected = true;
  }

  for (const offer of offers) {
    if (added.has(offer.url)) continue;
    const key = languageKey(offer.lang);
    group(key, languageName(key)).options.push({ kind: 'addon', sub: offer, label: offer.addon, detail: offerDetail(offer, best, video), sdh: !!offer.sdh });
  }

  const rank = (g: SubtitleGroup) => {
    if (g.key === UPLOADED_GROUP) return -1;
    const i = preferred.indexOf(g.key);
    return i >= 0 ? i : g.key === UNKNOWN_LANGUAGE ? Number.MAX_SAFE_INTEGER : preferred.length;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * The Subtitles view's option for track `id`, as picking it there gives it
 * (the phone remote picks by id): its SDH mark from mpv's flag or from the
 * addon offer it was added from, which its name alone doesn't carry.
 */
export function subtitleTrackOption(tracks: readonly TrackInfo[], offers: readonly AddonSubtitle[], id: number): SubtitleOption | undefined {
  return groupSubtitles(tracks, offers, [])
    .flatMap((g) => g.options)
    .find((o) => o.kind === 'track' && o.track.id === id);
}

/**
 * How well an offer fits the release playing, in a word: its `releaseScore`
 * (see subtitle-match.ts), or "Best match" for the one picked as best. A
 * score near nothing says too little to name; below zero something known
 * differs (another episode, cut or frame rate).
 */
export function matchLabel(score: number | undefined, best: boolean): MessageKey | null {
  if (best) return 'subs.best-match';
  if (score === undefined) return null;
  if (score >= BEST_MATCH_SCORE) return 'pstream.subs.match-good';
  if (score >= FAIR_MATCH_SCORE) return 'pstream.subs.match-fair';
  return score < 0 ? 'pstream.subs.match-poor' : null;
}

/** From here an offer is a fair match (the title alone scores about 30). */
const FAIR_MATCH_SCORE = 20;

/** "#2 · Movie 2019 1080p WEB-DL NTb · Good match": its number, its release name if known, and how well it fits the release playing. */
function offerDetail(offer: AddonSubtitle, best: ReadonlySet<string>, video?: Release): string {
  const match = matchLabel(video ? releaseScore(video, offerRelease(offer)) : undefined, best.has(offer.url));
  return [`#${offer.number}`, offer.name, match ? t(match) : ''].filter(Boolean).join(' · ');
}

/** Numbers each addon's offers per language: "OpenSubtitles v3 · English 2". */
export function titleOffers(subs: readonly { url: string; lang: string; addon: string; release?: SubtitleRelease | undefined; name?: string | undefined; sdh?: boolean | undefined }[]): AddonSubtitle[] {
  const counts = new Map<string, number>();
  return subs.map((s) => {
    const key = `${s.addon}|${languageKey(s.lang)}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { ...s, number: n, title: `${s.addon} · ${languageName(languageKey(s.lang))} ${n}` };
  });
}

/**
 * Whether a forced track (signs and foreign-language lines only) is right
 * for the audio playing: only when it's in the audio's language, or either
 * language is unknown. Forced English lines are no use over a French dub.
 */
export function forcedApplies(track: TrackInfo, audio: string): boolean {
  const lang = languageKey(track.lang);
  return !track.forced || audio === UNKNOWN_LANGUAGE || lang === UNKNOWN_LANGUAGE || lang === audio;
}

/**
 * When the subtitle on is a forced track that doesn't suit audio language
 * `audio`: the full track in its language to show instead, or null for none
 * (no subtitles rather than the wrong ones). Undefined leaves it as it is.
 */
export function forcedFix(tracks: readonly TrackInfo[], audio: string): { id: number | null } | undefined {
  const current = tracks.find((t) => t.kind === 'sub' && t.selected);
  if (!current || forcedApplies(current, audio)) return undefined;
  const full = tracks.find((t) => t.kind === 'sub' && !t.forced && languageKey(t.lang) === languageKey(current.lang));
  return { id: full?.id ?? null };
}

/** The release an offer is for: what the addon says, or its address. */
const offerRelease = (o: AddonSubtitle) => subtitleRelease(o.release ?? { name: o.url });

/**
 * The addon subtitle to load for language `want` when the file has no
 * subtitle in it, if any: the one made for the release playing (`video`),
 * or the addons' first. Nothing if a subtitle is already on (the file's own,
 * or one the viewer picked). A forced track counts only when the audio's
 * language or its own is unknown: over other audio it doesn't suit, and
 * over audio in its own language it holds only the foreign lines, not the
 * full subtitles wanted (the player doesn't ask with "forced only" on then).
 */
export function autoSubtitle(tracks: readonly TrackInfo[], offers: readonly AddonSubtitle[], want: string, audio: string = UNKNOWN_LANGUAGE, video?: Release): AddonSubtitle | undefined {
  const counts = (t: TrackInfo) => !t.forced || audio === UNKNOWN_LANGUAGE || languageKey(t.lang) === UNKNOWN_LANGUAGE;
  if (!want || tracks.some((t) => t.kind === 'sub' && counts(t) && (t.selected || languageKey(t.lang) === want))) return undefined;
  return rankOffers(offers, want, video)[0];
}

/**
 * The offers in language `lang`, best first: by how well they fit the
 * release playing (`video`), the addons' own order breaking ties (and
 * deciding alone when nothing is known about the release). The first is
 * the one `autoSubtitle` picks.
 */
export function rankOffers(offers: readonly AddonSubtitle[], lang: string, video?: Release): AddonSubtitle[] {
  const candidates = offers.filter((o) => languageKey(o.lang) === lang);
  if (!video || candidates.length < 2) return candidates;
  const scored = candidates.map((offer) => ({ offer, score: releaseScore(video, offerRelease(offer)) }));
  // Array sort is stable: equal scores keep the addons' order, as `bestMatch` does.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.offer);
}

/**
 * "Try another subtitle": the next offer after the one showing, in the
 * showing subtitle's language (or `want` with none on), cycling back to the
 * best after the last. `pending` names an offer just asked for that mpv
 * hasn't listed yet, so quick presses keep moving on. `track` is set when
 * that offer was added before (it's selected rather than added again).
 * Undefined when there's nothing else to switch to.
 */
export function nextOffer(
  tracks: readonly TrackInfo[],
  offers: readonly AddonSubtitle[],
  want: string,
  video?: Release,
  pending?: string,
): { offer: AddonSubtitle; position: number; total: number; lang: string; track?: TrackInfo | undefined } | undefined {
  const showing = tracks.find((t) => t.kind === 'sub' && t.selected);
  const currentTitle = pending ?? (showing?.external ? (showing.title ?? undefined) : undefined);
  const currentOffer = currentTitle === undefined ? undefined : offers.find((o) => o.title === currentTitle);
  const lang = currentOffer ? languageKey(currentOffer.lang) : showing ? languageKey(showing.lang) : want;
  if (!lang) return undefined;
  const ranked = rankOffers(offers, lang, video);
  const at = currentOffer ? ranked.indexOf(currentOffer) : -1;
  if (!ranked.length || (ranked.length === 1 && at === 0)) return undefined;
  const index = (at + 1) % ranked.length;
  const offer = ranked[index]!;
  return { offer, position: index + 1, total: ranked.length, lang, track: tracks.find((t) => t.kind === 'sub' && t.external && t.title === offer.title) };
}

/** Per language, the offer clearly made for the release playing (its address), for the "Best match" tag. */
export function bestOffers(offers: readonly AddonSubtitle[], video: Release | undefined): Set<string> {
  const best = new Set<string>();
  if (!video) return best;
  for (const lang of new Set(offers.map((o) => languageKey(o.lang)))) {
    const candidates = offers.filter((o) => languageKey(o.lang) === lang);
    const { index, score } = bestMatch(candidates, video, offerRelease);
    if (index >= 0 && score >= BEST_MATCH_SCORE) best.add(candidates[index]!.url);
  }
  return best;
}

/** Settings → Audio & Subtitles → Skip tracks named: comma-separated words. */
export const AVOID_TRACKS_KEY = 'player.avoid-tracks';
export const DEFAULT_AVOID_WORDS = 'commentary, audio description, descriptive';

/** The saved words (or the defaults), lower case, a sensible number of them. */
export function parseAvoidWords(value: unknown): string[] {
  const text = typeof value === 'string' ? value : DEFAULT_AVOID_WORDS;
  return text
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0 && w.length <= 40)
    .slice(0, 12);
}

/** Whether a track's name contains one of `words` (whole words, any case). */
export function isAvoided(track: TrackInfo, words: readonly string[]): boolean {
  const title = ` ${(track.title ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return words.some((w) => title.includes(` ${w.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `));
}

/**
 * When mpv picked a track of `kind` whose name is avoided, the one to use
 * instead: the same language first, then any other; undefined to keep it.
 */
export function replacementTrack(tracks: readonly TrackInfo[], kind: 'audio' | 'sub', words: readonly string[]): TrackInfo | undefined {
  const current = tracks.find((t) => t.kind === kind && t.selected);
  if (!current || !words.length || !isAvoided(current, words)) return undefined;
  const others = tracks.filter((t) => t.kind === kind && t.id !== current.id && !isAvoided(t, words));
  return others.find((t) => languageKey(t.lang) === languageKey(current.lang)) ?? others[0];
}

/**
 * The subtitle to turn on when the person asks for some (the Subtitles key,
 * "What did they say?"), for the first of `languages` there is one in: the
 * file's full subtitles, else an addon's (best for `video` first), else a
 * forced track, which holds only signs and foreign lines and would show next
 * to nothing. With none in those languages, the file's own in any language.
 * Full subtitles named with an avoided word (commentary) come last among them.
 */
export function subtitleToShow(tracks: readonly TrackInfo[], offers: readonly AddonSubtitle[], languages: readonly string[], words: readonly string[], video?: Release): { track: TrackInfo } | { offer: AddonSubtitle } | undefined {
  const subs = tracks.filter((t) => t.kind === 'sub');
  const best = (list: readonly TrackInfo[]) => list.find((t) => !t.forced && !isAvoided(t, words)) ?? list.find((t) => !t.forced) ?? list[0];
  for (const lang of languages) {
    const own = subs.filter((t) => languageKey(t.lang) === lang);
    const full = best(own.filter((t) => !t.forced));
    if (full) return { track: full };
    const offer = rankOffers(offers, lang, video)[0];
    if (offer) return { offer };
    if (own[0]) return { track: own[0] };
  }
  const any = best(subs);
  return any ? { track: any } : undefined;
}
