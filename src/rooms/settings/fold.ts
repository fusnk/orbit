/**
 * Settings' simple view: the rows marked advanced in the palette's index
 * (app/palette/settings-index.ts) fold away, and one "More options (n)"
 * button at the foot of the page (of the tab, on a tabbed page), above
 * Reset, opens them all where they belong, in their chapters. It says which
 * chapters it opens; a chapter left with nothing to show folds its heading
 * too. "Show all settings" in the sidebar shows every row everywhere.
 *
 * - A folded row that differs from its default stays visible with a small
 *   "Changed" tag, so nobody loses track of something they turned on; once
 *   shown it stays for the visit, so setting it back doesn't pull it away.
 * - Folded rows get `data-folded` (styled `display: none`), which keyboard,
 *   controller and screen readers skip like `hidden`. `hidden` itself stays
 *   with the dependent rows (dependent-rows.ts), so the two never fight.
 * - Panels draw (and redraw) their rows on their own; a MutationObserver
 *   folds whatever they draw, and puts the button back when they redraw.
 * - Which pages are open is kept for the session, outside the DOM, so a
 *   redraw (a Look redraws the whole Appearance page) keeps them open.
 */
import { advancedEntries, type SettingsEntry } from '../../app/palette/settings-index';
import { icon } from '../../components/icons';
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { SETTING_SAVED, settings } from '../../lib/ipc';
import { affects, changedRows, PREFS } from './defaults';
import { openDisclosureOf, setDisclosures } from './disclosure';

/** Per device: every row shown, nothing folded (off unless chosen). */
export const SHOW_ALL_KEY = 'settings.show-all';

let showAll = false;
/** Pages (or tabs) opened this session, by their fold key. */
const opened = new Set<string>();
const folds = new Map<HTMLElement, { apply(): void }>();

/** What takes focus in a row: its value, switch, slider or button. */
const FOCUSABLE = '[data-focus-id]:not(:disabled), button:not(:disabled), input:not(:disabled), [tabindex="0"]';

export const allShown = (): boolean => showAll;

export async function loadShowAll(): Promise<boolean> {
  showAll = (await settings.get(SHOW_ALL_KEY).catch(() => null)) === true;
  for (const fold of folds.values()) fold.apply();
  if (showAll) setDisclosures(true);
  return showAll;
}

export function setShowAll(on: boolean): void {
  showAll = on;
  for (const fold of folds.values()) fold.apply();
  setDisclosures(on);
  settings.set(SHOW_ALL_KEY, on).catch((err: unknown) => console.warn('Could not save', SHOW_ALL_KEY, err));
}

/** True when `el` is in `root` but inside an element hidden by `hidden`. */
const hiddenIn = (el: Element, root: Element): boolean => {
  const hidden = el.closest('[hidden]');
  return !!hidden && root.contains(hidden);
};

/** The element an index entry stands for on the page: its row by label, or its section by class. */
function unitsOf(body: HTMLElement, entries: readonly SettingsEntry[]): Map<HTMLElement, MessageKey> {
  const rows = new Map<string, HTMLElement>();
  for (const label of body.querySelectorAll<HTMLElement>('.setting-label')) {
    const row = label.closest<HTMLElement>('.setting-row');
    if (row && label.textContent && !rows.has(label.textContent)) rows.set(label.textContent, row);
  }
  const units = new Map<HTMLElement, MessageKey>();
  for (const entry of entries) {
    const el = entry.find === 'row' ? rows.get(t(entry.label)) : entry.find === 'heading' ? undefined : body.querySelector<HTMLElement>(entry.find);
    if (el) units.set(el, entry.label);
  }
  return units;
}

/**
 * Folds `category`'s advanced rows inside `body` (its panel), now and
 * whenever the panel redraws. `refresh` re-reads which rows are changed
 * (each time the category is shown).
 */
export function foldAdvanced(body: HTMLElement, category: string): { refresh(): void } {
  const entries = advancedEntries(category);
  if (!entries.length) return { refresh: () => {} };
  const prefs = (PREFS[category] ?? []).filter((pref) => entries.some((e) => e.label === pref.label));
  /** Rows that differ from their default now, and rows shown for that this visit. */
  let changed = new Set<MessageKey>();
  let kept = new Set<MessageKey>();
  const buttons = new Map<string, HTMLButtonElement>();

  function button(key: string): HTMLButtonElement {
    let b = buttons.get(key);
    if (!b) {
      b = h('button', { class: 'settings-more', 'aria-expanded': 'false', 'data-fold-group': key }, icon('chevronDown'), h('span', { class: 'settings-more-label' }), h('span', { class: 'settings-more-where' }));
      b.addEventListener('click', () => {
        const opening = !opened.has(key);
        if (opening) opened.add(key);
        else opened.delete(key);
        const revealed = apply();
        // Opened at the foot of the page: on to the first option it showed, up in its chapter.
        const first = opening ? revealed[0] : undefined;
        const target = first && [...first.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => el.getClientRects().length);
        if (!first || !target) return;
        first.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
      });
      buttons.set(key, b);
    }
    return b;
  }

  /** Folds what's folded now; returns the rows it shows that were folded (to focus the first after opening). */
  function apply(): HTMLElement[] {
    const units = unitsOf(body, entries);
    for (const [el, label] of units) el.dataset.advanced = label;
    const wasFolded = new Set(body.querySelectorAll<HTMLElement>('[data-folded]'));
    // A page's chapters: a heading and the rows after it. The fold is the page's, or its tab's.
    type Chapter = { key: string; heading: HTMLElement | null; units: HTMLElement[] };
    const chapters: Chapter[] = [];
    let chapter: Chapter | null = null;
    const start = (el: Element, heading: HTMLElement | null): Chapter => {
      const tab = el.closest<HTMLElement>('[data-tab]')?.dataset.tab ?? '';
      const next: Chapter = { key: `${category}|${tab}`, heading, units: [] };
      chapters.push(next);
      return next;
    };
    for (const el of body.querySelectorAll<HTMLElement>('.setting-row, .settings-subheading, [data-advanced]')) {
      // Rows and headings inside a folded section go with it.
      const outer = el.parentElement?.closest('[data-advanced]');
      if (outer && body.contains(outer)) continue;
      if (el.matches('.settings-subheading') && !units.has(el)) {
        chapter = start(el, el);
        continue;
      }
      chapter ??= start(el, null);
      if (units.has(el)) chapter.units.push(el);
    }

    // The page's foot (this fold's button, Reset) isn't part of its last chapter.
    const stops = [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('.settings-more, .settings-reset'));
    /** Whether nothing between `heading` and `next` can take focus now (all folded or hidden). */
    const empty = (heading: HTMLElement, next: HTMLElement | null | undefined) =>
      !stops.some((el) => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && (!next || next.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) && !el.closest('[data-folded], [hidden]'));
    const pages = new Map<string, { foldable: number; chapters: string[]; anchor: HTMLElement }>();
    for (const [i, c] of chapters.entries()) {
      const open = showAll || opened.has(c.key);
      let foldable = 0;
      for (const unit of c.units) {
        const label = units.get(unit)!;
        if (unit.dataset.foldGroup !== c.key) unit.dataset.foldGroup = c.key;
        const shownAnyway = changed.has(label) || kept.has(label);
        if (shownAnyway && !showAll) kept.add(label);
        const folded = !open && !shownAnyway;
        if (folded !== unit.hasAttribute('data-folded')) unit.toggleAttribute('data-folded', folded);
        if (!shownAnyway && !hiddenIn(unit, body) && !unit.hidden) foldable++;
        tag(unit, changed.has(label) && !showAll);
      }
      if (c.heading) {
        // A chapter of only folded rows folds its heading (and the line under it) too.
        const fold = !!c.units.length && empty(c.heading, chapters[i + 1]?.heading);
        const next = c.heading.nextElementSibling;
        const intro = next instanceof HTMLElement && next.matches('.settings-intro') ? next : null;
        for (const el of [c.heading, intro]) {
          if (!el) continue;
          if (el.dataset.foldGroup !== c.key) el.dataset.foldGroup = c.key;
          if (fold !== el.hasAttribute('data-folded')) el.toggleAttribute('data-folded', fold);
        }
      }
      if (!foldable) continue;
      const page = pages.get(c.key) ?? { foldable: 0, chapters: [], anchor: c.units[0]! };
      page.foldable += foldable;
      if (c.heading?.textContent) page.chapters.push(c.heading.textContent);
      pages.set(c.key, page);
    }

    const focused = document.activeElement;
    const wanted = new Set<HTMLButtonElement>();
    if (!showAll) {
      for (const [key, page] of pages) {
        const b = button(key);
        wanted.add(b);
        const open = opened.has(key);
        const label = b.children[1]!;
        const where = b.children[2]!;
        const text = open ? t('settings.fold.fewer') : t('settings.fold.more', { count: page.foldable });
        if (label.textContent !== text) label.textContent = text;
        const chaptersText = open ? '' : new Intl.ListFormat(locale(), { style: 'narrow' }).format(page.chapters);
        if (where.textContent !== chaptersText) where.textContent = chaptersText;
        b.setAttribute('aria-expanded', String(open));
        // At the foot of the page (or its tab), above "Reset this section".
        const scope = page.anchor.closest<HTMLElement>('[data-tab]') ?? body;
        const feet = scope === body ? body.querySelectorAll(':scope > .settings-reset') : scope.querySelectorAll('.settings-reset');
        const foot = feet[feet.length - 1];
        if (foot ? foot.previousElementSibling !== b : scope.lastElementChild !== b) {
          if (foot) foot.before(b);
          else scope.append(b);
        }
      }
    }
    for (const b of buttons.values()) if (!wanted.has(b) && b.isConnected) b.remove();
    // Focus never stays on something that just folded away: its page's button takes it.
    const gone = focused instanceof HTMLElement && body.contains(focused) ? focused.closest<HTMLElement>('[data-folded]') : null;
    if (gone?.dataset.foldGroup) buttons.get(gone.dataset.foldGroup)?.focus({ preventScroll: true });
    observer.takeRecords();
    return [...wasFolded].filter((el) => !el.matches('.settings-subheading, .settings-intro') && !el.hasAttribute('data-folded'));
  }

  /** "Changed" beside a folded row's name (not inside it: the palette finds rows by their exact label). */
  function tag(unit: HTMLElement, on: boolean): void {
    const existing = unit.querySelector(':scope .setting-changed');
    if (!on) return void existing?.remove();
    if (existing) return;
    const name = unit.querySelector('.setting-label, .settings-subheading');
    name?.after(h('span', { class: 'setting-changed' }, t('settings.fold.changed')));
  }

  let timer: number | undefined;
  function refresh(keep = false): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void changedRows(category).then((now) => {
        changed = new Set([...now].filter((label) => prefs.some((p) => p.label === label)));
        if (!keep) kept = new Set();
        apply();
      });
    }, 60);
  }

  const observer = new MutationObserver(apply);
  observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener(SETTING_SAVED, (event) => {
    const key = (event as CustomEvent<string>).detail;
    if (key !== SHOW_ALL_KEY && prefs.some((pref) => affects(pref, key))) refresh(true);
  });
  folds.set(body, { apply });
  apply();
  refresh();
  return { refresh: () => refresh() };
}

/**
 * Opens the group `el` is folded in, if it is (the palette jumping to an
 * advanced row, a link to a folded section), or the disclosure it's in.
 */
export function unfold(el: HTMLElement): void {
  openDisclosureOf(el);
  const unit = el.closest<HTMLElement>('[data-folded]');
  if (!unit?.dataset.foldGroup) return;
  opened.add(unit.dataset.foldGroup);
  for (const [body, fold] of folds) if (body.contains(unit)) fold.apply();
}
