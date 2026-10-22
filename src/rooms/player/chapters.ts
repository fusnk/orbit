/**
 * The Chapters view (hub → Chapters): the file's chapters with their start
 * times, the one playing marked. Picking one jumps to its start. Only listed
 * when the file has chapters (most streams have none).
 */
import { t } from '../../i18n';
import type { Chapter } from './skip';

/** The chapter playing at `position` (the last to start at or before it), or -1 before the first or with none. */
export function currentChapter(chapters: readonly Chapter[], position: number | null): number {
  if (position === null) return -1;
  let index = -1;
  // mpv lists chapters in order; a stray one out of order doesn't hide the rest.
  chapters.forEach((chapter, i) => {
    if (chapter.time <= position + 0.25 && (index < 0 || chapter.time >= chapters[index]!.time)) index = i;
  });
  return index;
}

/** A chapter's name, or "Chapter 3" when the file gives none. Titles come from the file, so they're shown as text only. */
export function chapterName(chapter: Chapter, index: number): string {
  const title = chapter.title?.trim().slice(0, 200);
  return title || t('player.chapters.untitled', { number: String(index + 1) });
}

/**
 * Whether the chapter keys (PageUp/PageDown) have anywhere to go: a file that has started and lists
 * chapters. mpv refuses to step through a file without any (most streams), and that refusal showed
 * as "Couldn't change chapter" for a key that simply has nothing to do there.
 */
export const canStepChapter = (chapters: readonly Chapter[], started: boolean): boolean => started && chapters.length > 0;
