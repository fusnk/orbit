/**
 * My Library → History: what was watched, newest first, by day, with a name
 * filter. Rows are drawn a chunk at a time as the list scrolls, so thousands
 * of entries stay quick. The grouping lives in library/history.ts.
 *
 * Each entry's menu opens or plays the title, or takes it out of history
 * (see `removeHistory` in watch.ts: Orbit's history only, never Stremio's).
 */
import type { RoomContext } from '../../app/router';
import { shownNow, verdictNow } from '../../catalog/parental';
import { loadMeta } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { icon } from '../../components/icons';
import { withContextMenu, type MenuItem } from '../../components/menu';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t, tn } from '../../i18n';
import { clockFormat } from '../../lib/clock';
import { h } from '../../lib/dom';
import { filterHistory, groupByDay, historyEntries, type HistoryEntry } from '../../library/history';
import { historyRows, historyUndo, removeHistory, type Progress } from '../../library/watch';
import { pageLeft } from '../detail/page-left';
import { playTitle } from '../detail/streams';

/** Entries drawn at a time. */
const CHUNK = 60;
/** At most this many episode codes on a collapsed entry. */
const MAX_CODES = 4;

const code = (row: Progress) => t('titles.common.episode-code', { season: row.season ?? 0, episode: row.episode ?? 0 });

export function createHistoryView(ctx: RoomContext, actions: { openDetail(title: Title): void }) {
  const time = clockFormat();
  let all: HistoryEntry[] = [];
  let shown: HistoryEntry[] = [];
  /** How many of `shown` are drawn, and the day they were last added to. */
  let drawn = 0;
  let lastDay: { key: string; list: HTMLElement } | undefined;
  /** Episode names by video id, per series, once its details are loaded (history keeps only numbers). */
  const names = new Map<string, Promise<Map<string, string>>>();

  const search = createTextField({ label: t('insights.history.search'), placeholder: t('insights.history.search'), onSubmit: () => {}, className: 'library-search' });
  search.addEventListener('input', () => redraw(0));
  const count = h('span', { class: 'segment-count' });
  const list = h('div', { class: 'history-list' });
  const empty = h('div', { class: 'library-none', hidden: true });
  // Reaching the end of what's drawn draws the next chunk (the margin keeps ahead of the scroll).
  const sentinel = h('div', { class: 'history-sentinel', 'aria-hidden': 'true' });
  new IntersectionObserver((seen) => {
    if (seen.some((s) => s.isIntersecting)) drawMore();
  }, { rootMargin: '0px 0px 800px 0px' }).observe(sentinel);

  const element = h(
    'section',
    { class: 'library-section history' },
    h('div', { class: 'library-filters' }, h('h2', { class: 'library-heading' }, t('insights.history.tab'), count), h('span', { class: 'library-filters-gap' }), search),
    list,
    empty,
    sentinel,
  );

  /** The series' episode names, loaded once (cached by the catalog too). */
  function episodeNames(title: Title): Promise<Map<string, string>> {
    let found = names.get(title.id);
    if (!found) {
      found = loadMeta(title.type, title.id)
        .then((full) => new Map((full?.seasons ?? []).flatMap((s) => s.episodes.map((e) => [e.id, e.title] as const))))
        .catch(() => new Map<string, string>());
      names.set(title.id, found);
    }
    return found;
  }

  /** "S2 · E4 · Name", "3 episodes · S1 · E3, S1 · E4, S1 · E5", or a movie's year. */
  function subtitle(entry: HistoryEntry, sub: HTMLElement): string {
    const episodes = entry.rows.filter((r) => r.season !== null && r.episode !== null);
    if (!episodes.length) return entry.title.year ?? '';
    if (episodes.length > 1) {
      // Oldest first, as they were watched.
      const codes = [...episodes].reverse().map(code);
      const listed = codes.length > MAX_CODES ? [...codes.slice(0, MAX_CODES), '…'] : codes;
      return `${tn('insights.history.episodes', episodes.length)} · ${listed.join(', ')}`;
    }
    const row = episodes[0]!;
    if (!entry.file) {
      void episodeNames(entry.title).then((found) => {
        const name = found.get(row.videoId);
        if (name && sub.isConnected) sub.textContent = `${code(row)} · ${name}`;
      });
    }
    return code(row);
  }

  /** Plays the entry's newest movie or episode (resuming as Settings say). */
  async function playFrom(entry: HistoryEntry): Promise<void> {
    const row = entry.rows[0]!;
    if (row.season === null || row.episode === null) return playTitle(entry.title, { ctx });
    // The episode list can take a while: if the person has moved on meanwhile, nothing opens over where they are now.
    const left = pageLeft();
    const full = await loadMeta(entry.title.type, entry.title.id).catch(() => null);
    if (left()) return;
    const season = full?.seasons?.find((s) => s.number === row.season);
    const episode = season?.episodes.find((e) => e.id === row.videoId) ?? season?.episodes.find((e) => e.number === row.episode);
    if (full && episode) return playTitle(full, { episode: { season: row.season, episode }, ctx });
    actions.openDetail(entry.title);
  }

  /** Removes from history, keeping keyboard focus at the same place in the list. */
  function remove(entry: HistoryEntry, videoIds: readonly string[] | undefined, message: string): void {
    const rows = [...list.querySelectorAll<HTMLElement>('.history-entry')];
    const index = rows.findIndex((r) => r.dataset.focusId === `history:${entry.key}`);
    const hadFocus = index >= 0 && rows[index] === document.activeElement;
    const undo = historyUndo(entry.title.id, videoIds);
    removeHistory(entry.title.id, videoIds)
      .then(() => toast(message, { action: { label: t('pages.undo'), run: undo } }))
      .catch((err: unknown) => {
        console.error('Could not remove watch history', err);
        toast(t('insights.history.remove-failed'));
      });
    if (!hadFocus) return;
    // The list redraws as watch history changes; focus the entry now in its place.
    queueMicrotask(() => {
      const now = [...list.querySelectorAll<HTMLElement>('.history-entry')];
      (now[Math.min(index, now.length - 1)] ?? search).focus({ preventScroll: true });
    });
  }

  function menu(entry: HistoryEntry): MenuItem[] {
    const items: MenuItem[] = [];
    if (!entry.file) {
      items.push({ label: t('titles.actions.view-details'), action: () => actions.openDetail(entry.title) });
      items.push({ label: t('insights.history.play-from-here'), action: () => void playFrom(entry) });
    }
    const ids = entry.rows.map((r) => r.videoId);
    items.push({ label: t('insights.history.remove'), action: () => remove(entry, ids, t('insights.history.removed', { name: entry.title.name })) });
    // Only when the title has more in history than this entry.
    if (all.some((e) => e !== entry && e.title.id === entry.title.id)) {
      items.push({ label: t('insights.history.clear-title'), action: () => remove(entry, undefined, t('insights.history.cleared', { name: entry.title.name })) });
    }
    return items;
  }

  function row(entry: HistoryEntry): HTMLElement {
    const poster = h('span', { class: 'history-poster', 'aria-hidden': 'true' }, icon(entry.file ? 'film' : 'play'));
    if (entry.title.poster) poster.append(artImage(entry.title.poster, 'history-poster-img'));
    const sub = h('span', { class: 'history-sub' });
    sub.textContent = subtitle(entry, sub);
    const button = h(
      'button',
      { class: 'history-entry', 'data-focus-id': `history:${entry.key}` },
      poster,
      h('span', { class: 'history-text' }, h('span', { class: 'history-name' }, entry.title.name), sub),
      h('time', { class: 'history-time', datetime: new Date(entry.at).toISOString() }, time.format(entry.at)),
    );
    // A file can't be opened from here; its menu still removes it.
    if (!entry.file) button.addEventListener('click', () => actions.openDetail(entry.title));
    return withContextMenu(button, () => menu(entry));
  }

  /** Draws the next chunk of entries, under their days. */
  function drawMore(): void {
    if (drawn >= shown.length) return;
    const chunk = shown.slice(drawn, drawn + CHUNK);
    for (const day of groupByDay(chunk, Date.now(), locale())) {
      if (lastDay?.key !== day.key) {
        const dayList = h('div', { class: 'history-day-list' });
        list.append(h('section', { class: 'history-day' }, h('h3', { class: 'history-day-label' }, day.label), dayList));
        lastDay = { key: day.key, list: dayList };
      }
      lastDay.list.append(...day.entries.map(row));
    }
    drawn += chunk.length;
  }

  /**
   * Draws from the top: after history changes or the filter does. `keep`: at least this many
   * entries are drawn again (what was scrolled into view), so a change while scrolled deep
   * into history doesn't shrink the page under the person and lose their place.
   */
  function redraw(keep: number): void {
    const focusId = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    shown = filterHistory(all, search.value);
    count.textContent = search.value.trim() ? t('titles.library.shown-of', { shown: shown.length, total: all.length }) : String(all.length);
    list.replaceChildren();
    lastDay = undefined;
    drawn = 0;
    drawMore();
    while (drawn < Math.min(keep, shown.length)) drawMore();
    // Keep the focused entry's chunk drawn (if it's still listed), so focus stays where it was.
    const target = focusId ? shown.findIndex((e) => `history:${e.key}` === focusId) : -1;
    if (target >= 0) {
      while (drawn <= target) drawMore();
      list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId!)}"]`)?.focus({ preventScroll: true });
    }
    empty.hidden = shown.length > 0;
    empty.replaceChildren(h('p', { class: 'muted' }, all.length ? t('titles.library.no-match') : t('insights.history.empty')));
  }

  /** Reads watch history again; one function, so a wait for ratings isn't queued again on every refresh. */
  const read = (): void => {
    // Only what this profile may watch now (its content limit): the rest stays in the history, unlisted.
    all = shownNow(historyEntries(historyRows()), (entry) => entry.title, read);
    redraw(drawn);
  };

  return {
    element,
    /** Reads watch history again (the page calls this as it redraws). */
    refresh: read,
  };
}

/**
 * How many entries History would list (for the tab's count): not those the
 * content limit blocks, as the list leaves them out. One whose rating is still
 * being looked up counts, so the tab doesn't come and go while it's found.
 */
export const historyCount = (): number => historyEntries(historyRows()).filter((entry) => verdictNow(entry.title) !== 'blocked').length;
