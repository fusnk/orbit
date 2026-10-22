/**
 * Small fuzzy matching for the command palette: how well a typed query
 * matches a label, as a score (higher is better) or null for no match.
 *
 * Tiers, best first: the whole text, a prefix of it, the start of a word,
 * every query word starting a word, anywhere inside, every query word
 * anywhere, and (when `loose`) the letters in order starting at a word, like
 * "hwd" for "Hardware decoding". Within a tier shorter texts win.
 *
 * Comparison ignores case, accents and punctuation, and in Arabic the hamza
 * forms of alef, tashkeel, tatweel, ta marbuta and alef maqsura, so people
 * find things however they type them.
 */

export interface Prepared {
  /** Normalised text: words separated by single spaces. */
  text: string;
  words: readonly string[];
}

/** Letters NFD leaves whole, spelled the way people type them without the accent. */
const FOLD: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', 'ى': 'ي', 'ة': 'ه' };

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    // Combining marks: Latin accents, and Arabic tashkeel and hamza above/below alef (أ إ آ → ا).
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđßæœıىة]/g, (c) => FOLD[c] ?? c)
    // Tatweel only stretches a word.
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function prepare(text: string): Prepared {
  const normal = normalize(text);
  return { text: normal, words: normal ? normal.split(' ') : [] };
}

/**
 * The tier for letters in order, starting at a word: 101–399, by how many land
 * on word starts and run together. Each next letter is later in the same word
 * or starts a later word ("hwd" → HardWare Decoding, "rtwm" → Race To Witch
 * Mountain), so letters picked from the middles of different words ("ronin" →
 * Race tO witch mouNtaIN) don't count.
 */
function inOrder(query: string, text: string): number | null {
  if (query.length < 2) return null;
  let start = -1;
  for (let i = text.indexOf(query[0]!); i >= 0; i = text.indexOf(query[0]!, i + 1)) {
    if (i === 0 || text[i - 1] === ' ') {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let score = 100;
  let previous = start;
  for (let q = 1; q < query.length; q++) {
    const letter = query[q]!;
    let i: number;
    if (text[previous + 1] === letter) {
      i = previous + 1;
      score += 10;
    } else {
      // Later in the same word, else the next word that starts with it.
      const same = text.indexOf(letter, previous + 1);
      const wordEnd = text.indexOf(' ', previous + 1);
      if (same >= 0 && (wordEnd < 0 || same < wordEnd)) {
        i = same;
      } else {
        i = text.indexOf(` ${letter}`, previous + 1) + 1;
        if (i <= 0) return null;
        score += 20;
      }
    }
    score -= Math.min(i - previous - 1, 10);
    previous = i;
  }
  return Math.max(101, Math.min(399, score));
}

/**
 * How well `query` matches `target` (both from `prepare`). An empty query
 * matches everything with 0. Without `loose`, letters in order don't count
 * (for long texts like keywords, where they'd match nearly anything).
 */
export function fuzzyScore(query: Prepared, target: Prepared, loose = true): number | null {
  const q = query.text;
  const s = target.text;
  if (!q) return 0;
  if (!s) return null;
  let tier: number | null = null;
  if (s === q) tier = 1000;
  else if (s.startsWith(q)) tier = 900;
  else if (` ${s}`.includes(` ${q}`)) tier = 800;
  else if (query.words.length > 1 && query.words.every((w) => target.words.some((t) => t.startsWith(w)))) tier = 700;
  else if (s.includes(q)) tier = 600;
  else if (query.words.length > 1 && query.words.every((w) => s.includes(w))) tier = 500;
  else if (loose) tier = inOrder(q.replace(/ /g, ''), s);
  // Shorter texts first within a tier; never enough to cross into another tier.
  return tier === null ? null : tier - Math.min(s.length, 99) / 100;
}
