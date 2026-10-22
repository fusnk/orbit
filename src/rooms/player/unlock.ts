/** Unlocking the player's controls with Esc pressed three times in a row (see lock.ts). */

/** Esc presses this close together count towards unlocking. */
export const ESC_WINDOW_MS = 1500;
export const ESC_TIMES = 3;

/** The Esc presses still counting: those within the window of the latest. */
export function escCount(presses: readonly number[], now: number): number {
  return presses.filter((at) => now - at <= ESC_WINDOW_MS).length;
}
