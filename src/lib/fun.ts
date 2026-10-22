/**
 * Small extras (Settings → Appearance → Little extras): the launch ident,
 * the Surprise Me roulette, loading quips, rotating search hints and
 * seasonal touches. The pure parts live here so they can be tested: which
 * season a date falls in, the saved switches, and the orders things rotate in.
 */

export type Season = 'halloween' | 'winter';

/** Halloween from 15 to 31 October, winter from 15 to 31 December (local dates). */
export function seasonOn(date: Date): Season | null {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 9 && day >= 15) return 'halloween';
  if (month === 11 && day >= 15) return 'winter';
  return null;
}

export interface FunPrefs {
  /** The Orbit ident when the app starts. */
  intro: boolean;
  /** Surprise Me spins posters before showing its pick. */
  roulette: boolean;
  /** A rotating one-liner while a video loads. */
  quips: boolean;
  /** Example searches cycling in the empty search field. */
  hints: boolean;
  /** A tiny glyph by the logo around Halloween and late December. */
  seasonal: boolean;
  /** Joke languages (Pirate, UwU, runes, upside down) offered in the language picker. */
  languages: boolean;
}

/** The setting that holds the switches. */
export const FUN_KEY = 'fun';

export const FUN_DEFAULTS: FunPrefs = { intro: true, roulette: true, quips: true, hints: true, seasonal: true, languages: false };

/** Every switch is at its default unless saved as a boolean (a hand-edited backup can hold anything). */
export function parseFun(value: unknown): FunPrefs {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const on = (key: keyof FunPrefs) => (typeof saved[key] === 'boolean' ? (saved[key] as boolean) : FUN_DEFAULTS[key]);
  return { intro: on('intro'), roulette: on('roulette'), quips: on('quips'), hints: on('hints'), seasonal: on('seasonal'), languages: on('languages') };
}

/**
 * Indices 0…count-1 in a shuffled order, reshuffled each time round, so each
 * line shows once per round and none shows twice in a row (also where one
 * round meets the next).
 */
export function createRotation(count: number, random: () => number = Math.random): () => number {
  let order: number[] = [];
  let last = -1;
  return () => {
    if (count <= 1) return 0;
    if (!order.length) {
      order = shuffle(
        Array.from({ length: count }, (_, i) => i),
        random,
      );
      if (order[0] === last) order.push(order.shift()!);
    }
    last = order.shift()!;
    return last;
  };
}

/**
 * The roulette's reel: `others` shuffled and repeated to fill `length - 1`
 * places, then `pick` last, where the reel stops. No neighbours are the same
 * title, as long as there are at least two others.
 */
export function rouletteReel<T>(pick: T, others: readonly T[], length: number, random: () => number = Math.random): T[] {
  const reel: T[] = [];
  if (others.length) {
    let round: T[] = [];
    while (reel.length < length - 1) {
      if (!round.length) {
        round = shuffle([...others], random);
        if (round.length > 1 && round[0] === reel[reel.length - 1]) round.push(round.shift()!);
      }
      reel.push(round.shift()!);
    }
  }
  reel.push(pick);
  return reel;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
