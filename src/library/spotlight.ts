/**
 * My Library's featured banner: the title you're most likely to pick up
 * again (the newest in Continue Watching), else the latest addition, with
 * artwork when one of them has it. Pure, so it can be tested without the page.
 */
import type { Title } from '../catalog/titles';

export type Spotlight<E extends { title: Title }> = { kind: 'resume'; entry: E; title: Title } | { kind: 'added'; title: Title };

/**
 * `resume`: Continue Watching, newest first. `saved`: the library, newest
 * addition first. `allowed`: what the profile's content limit lets it show.
 */
export function spotlight<E extends { title: Title }>(resume: readonly E[], saved: readonly { title: Title }[], allowed: (title: Title) => boolean): Spotlight<E> | undefined {
  const entry = resume.find((e) => allowed(e.title));
  if (entry) return { kind: 'resume', entry, title: entry.title };
  const shown = saved.map((s) => s.title).filter(allowed);
  // A banner without art is a dark box: a slightly older addition with a backdrop reads better.
  const title = shown.slice(0, 6).find((t) => t.background) ?? shown[0];
  return title ? { kind: 'added', title } : undefined;
}
