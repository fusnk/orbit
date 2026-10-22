/** Subtitle transcript rules, independent of the player and DOM. Times stay in mpv seconds. */
export interface TranscriptCue { start: number; end: number; text: string }
export interface TranscriptData { trackId: number | null; available: boolean; cues: TranscriptCue[] }
export const TRANSCRIPT_WHOLE_KEY = 'player.transcript-whole';
export const FOLLOW_RESUME_MS = 4000;
export const TRANSCRIPT_PAGE_SIZE = 200;

/** Hide unreached lines before searching so match counts cannot reveal future dialogue. */
export function transcriptIndices(cues: readonly TranscriptCue[], time: number, delay: number, whole: boolean, query: string): number[] {
  const needle = query.trim().toLocaleLowerCase();
  return cues.flatMap((cue, index) => (whole || cue.start + delay <= time) && (!needle || cue.text.toLocaleLowerCase().includes(needle)) ? [index] : []);
}

/** All overlapping cues are current; end is exclusive, matching subtitle display intervals. */
export function currentCues(cues: readonly TranscriptCue[], time: number, delay: number): number[] {
  return cues.flatMap((cue, index) => cue.start + delay <= time && time < cue.end + delay ? [index] : []);
}
export const cueSeekTime = (cue: TranscriptCue, delay: number): number => Math.max(0, cue.start + delay);
export const shouldFollow = (now: number, lastInteraction: number): boolean => now - lastInteraction >= FOLLOW_RESUME_MS;
export const transcriptEscape = (query: string): 'clear' | 'close' => query.length ? 'clear' : 'close';
export function nextMatch(indices: readonly number[], current: number, direction: 1 | -1): number | undefined {
  if (!indices.length) return undefined;
  const index = indices.indexOf(current);
  return indices[(index < 0 ? (direction === 1 ? 0 : indices.length - 1) : (index + direction + indices.length) % indices.length)];
}

/** Plain slices make highlighting safe even if dialogue contains HTML-like text. */
export function matchSlices(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const folded = text.toLocaleLowerCase();
  // Case folding can change length (e.g. Turkish dotted I). Keep offsets correct by declining marks there.
  if (folded.length !== text.length || needle.length !== query.trim().length) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  let at: number;
  while ((at = folded.indexOf(needle, from)) >= 0) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
