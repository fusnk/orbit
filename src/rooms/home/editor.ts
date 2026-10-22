/**
 * The Home builder (Settings → Library & Metadata → Home rows): move rows
 * up or down, hide them, pick each rail's style, and add, rename or remove
 * rows of your own. Changes save at once and Home follows them.
 */
import { t, tn } from '../../i18n';
import { usableAddons } from '../../catalog/service';
import { streamingServices, type StreamingService } from '../../catalog/tmdb';
import { browsableCatalogs, railTitle, type CatalogRef } from '../../catalog/titles';
import { createSwitch } from '../../components/switch';
import { beginEditing, createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { errorText } from '../../components/state-message';
import { h } from '../../lib/dom';
import { jellyfinLibraries, jellyfinStatus } from '../../library/jellyfin';
import { plexLibraries, plexStatus } from '../../library/plex';
import { customLists } from '../../library/lists';
import { collectionGroups, loadCollections } from '../../library/collections';
import { MOODS } from './moods';
import { catalogGenres, moodLabel } from './row-render';
import { choices, row as settingRow } from '../settings/playback';
import {
  arrange,
  dashboardLayout,
  HOME_ROWS_KNOWN,
  homeLayout,
  keepUnshown,
  knownRows,
  MAX_ADDED,
  movedOrder,
  newRowId,
  resetArrangement,
  restorePrevious,
  ROW_STYLES,
  updateLayout,
  withHalf,
  withExtra,
  withHeroNext,
  type HomeExtra,
  type HomeLayout,
  type RowSource,
  type RowStyle,
} from './rows';
import './editor.css';

const STYLE_LABELS: Record<RowStyle, () => string> = {
  poster: () => t('homerows.style.poster'),
  landscape: () => t('homerows.style.landscape'),
  top10: () => t('homerows.style.top10'),
};

const KINDS = ['catalog', 'genre', 'list', 'library', 'service', 'mood', 'tiles', 'collections', 'jellyfin', 'plex'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABELS: Record<Kind, () => string> = {
  catalog: () => t('homerows.kind.catalog'),
  genre: () => t('homerows.kind.genre'),
  list: () => t('homerows.kind.list'),
  library: () => t('titles.common.my-library'),
  service: () => t('homerows.kind.service'),
  mood: () => t('homerows.kind.mood'),
  tiles: () => t('homerows.kind.tiles'),
  collections: () => t('collections.row.kind'),
  jellyfin: () => t('jellyfin.rows.kind'),
  plex: () => t('plex.rows.kind'),
};

function failed(err: unknown): void {
  console.error('Could not save the Home layout', err);
  toast(t('settings.common.save-failed'));
}

const sameSource = (a: RowSource, b: RowSource) => JSON.stringify(a) === JSON.stringify(b);

/** The shown panel's HOME_ROWS_KNOWN listener (see the end of homeRowsSection). */
let rowsKnownListener: AbortController | null = null;

export function homeRowsSection(): HTMLElement {
  const list = h('ol', { class: 'home-rows-list', 'aria-label': t('settings.library.home-rows') });
  const reset = h('button', { class: 'button' }, t('settings.library.reset'));
  const adder = h('div', { class: 'home-add' });
  /** The Dashboard preset and the banner's option: redrawn with the list, since a preset changes both. */
  const layoutOptions = h('div', { class: 'home-layout-options' });
  const section = h(
    'div',
    { class: 'home-rows-section' },
    h('div', { class: 'addons-heading' }, h('h3', { class: 'settings-subheading' }, t('settings.library.home-rows')), reset),
    h('p', { class: 'muted settings-intro' }, t('homerows.intro')),
    layoutOptions,
    list,
    adder,
  );
  let layout: HomeLayout | null = null;
  /** The added row being renamed, if any. */
  let renaming: string | null = null;
  /** A control to focus after the next redraw (it rebuilds the list). */
  let pendingFocus: string | null = null;

  async function change(next: (current: HomeLayout) => HomeLayout, focus?: string): Promise<void> {
    pendingFocus = focus ?? null;
    await updateLayout(next).catch(failed);
    layout = await homeLayout();
    draw();
  }

  function drawLayoutOptions(current: HomeLayout, rowsKnown: boolean): void {
    const focused = document.activeElement instanceof HTMLElement && layoutOptions.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const dashboard = h('button', { class: 'button', 'data-focus-id': 'layout:dashboard', disabled: !rowsKnown }, t('homerows.preset.use'));
    dashboard.addEventListener('click', () => void change((l) => dashboardLayout(l, knownRows().map((r) => r.id)), 'layout:dashboard').then(() => toast(t('homerows.preset.applied'))));
    const restore = h('button', { class: 'button', 'data-focus-id': 'layout:restore' }, t('homerows.preset.restore'));
    restore.addEventListener('click', () => void change(restorePrevious, 'layout:dashboard').then(() => toast(t('homerows.preset.restored'))));
    const heroNext = createSwitch('', !!current.heroNext, (on) => void change((l) => withHeroNext(l, on), 'layout:hero'));
    heroNext.setAttribute('aria-label', t('homerows.hero-next'));
    heroNext.dataset.focusId = 'layout:hero';
    const extra = (key: HomeExtra, label: string) => {
      const toggle = createSwitch('', current[key] !== false, (on) => void change((l) => withExtra(l, key, on), `layout:${key}`));
      toggle.setAttribute('aria-label', label);
      toggle.dataset.focusId = `layout:${key}`;
      return toggle;
    };
    layoutOptions.replaceChildren(
      settingRow(t('homerows.preset.dashboard'), t('homerows.preset.dashboard-hint'), h('div', { class: 'home-layout-actions' }, current.previous ? restore : '', dashboard)),
      settingRow(t('homerows.hero-next'), t('homerows.hero-next-hint'), heroNext),
      settingRow(t('homerows.greeting.label'), t('homerows.greeting.hint'), extra('greeting', t('homerows.greeting.label'))),
      settingRow(t('homerows.tags.label'), t('homerows.tags.hint'), extra('cardTags', t('homerows.tags.label'))),
    );
    // A control here that asked for focus after its change (Restore disappears once used), or the one that had it.
    const target = pendingFocus?.startsWith('layout:') ? pendingFocus : focused;
    if (target) layoutOptions.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(target)}"]:not(:disabled)`)?.focus();
  }

  function draw(): void {
    if (!layout) return;
    drawLayoutOptions(layout, knownRows().length > 0);
    const active = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? (document.activeElement.dataset.focusId ?? null) : null;
    // A redraw while renaming keeps what was typed.
    const typed = list.querySelector<HTMLInputElement>('.home-row-rename')?.value;
    const current = layout;
    const rows = knownRows();
    if (!rows.length) {
      list.replaceChildren(h('li', { class: 'muted' }, t('settings.library.home-rows-empty')));
      return;
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const order = arrange(
      rows.map((r) => r.id),
      current.order,
    );
    // From the layout as it is when the change runs (a quick second press moves again), keeping rows not shown now.
    const move = (index: number, by: number) => {
      const id = order[index]!;
      void change((l) => ({ ...l, order: movedOrder(order, l.order, id, by) }), `${id}:${by < 0 ? 'up' : 'down'}`);
    };
    list.replaceChildren(
      ...order.map((id, i) => {
        const row = byId.get(id)!;
        const hidden = current.hidden.includes(id);
        const name = row.label;
        const controls = h('div', { class: 'home-row-controls' });
        if (row.style) {
          const styles = choices(
            t('homerows.style-of', { name }),
            ROW_STYLES.map((style) => [style, STYLE_LABELS[style]()] as const),
            row.style,
            (style) => void change((l) => ({ ...l, styles: { ...l.styles, [id]: style } }), `${id}:style:${style}`),
          );
          styles.querySelectorAll<HTMLButtonElement>('button').forEach((button, n) => (button.dataset.focusId = `${id}:style:${ROW_STYLES[n]!}`));
          controls.append(styles);
        }
        if (row.added) {
          const rename = h('button', { class: 'button', 'data-focus-id': `${id}:rename`, 'aria-label': t('homerows.rename-row', { name }) }, t('homerows.rename'));
          rename.addEventListener('click', () => {
            renaming = id;
            pendingFocus = `${id}:name`;
            draw();
          });
          const remove = h('button', { class: 'button', 'data-focus-id': `${id}:remove`, 'aria-label': t('homerows.remove-row', { name }) }, t('homerows.remove'));
          remove.addEventListener('click', () => {
            // Focus moves to the next row (or the one before, at the end).
            const neighbour = order[i + 1] ?? order[i - 1];
            void change(
              (l) => ({
                ...withHalf(l, id, false),
                added: l.added.filter((r) => r.id !== id),
                order: l.order.filter((other) => other !== id),
                hidden: l.hidden.filter((other) => other !== id),
                styles: Object.fromEntries(Object.entries(l.styles).filter(([other]) => other !== id)),
              }),
              neighbour ? `${neighbour}:show` : undefined,
            );
          });
          controls.append(rename, remove);
        }
        const isHalf = current.half?.includes(id) ?? false;
        const half = h('button', { class: 'button', 'data-focus-id': `${id}:half`, 'aria-pressed': String(isHalf), 'aria-label': t('homerows.half-row', { name }), title: t('homerows.half-hint') }, t('homerows.half'));
        half.addEventListener('click', () => void change((l) => withHalf(l, id, !isHalf), `${id}:half`));
        controls.append(half);
        const up = h('button', { class: 'button', 'data-focus-id': `${id}:up`, disabled: i === 0, 'aria-label': t('settings.library.move-up', { name }) }, t('settings.library.up'));
        up.addEventListener('click', () => move(i, -1));
        const down = h('button', { class: 'button', 'data-focus-id': `${id}:down`, disabled: i === order.length - 1, 'aria-label': t('settings.library.move-down', { name }) }, t('settings.library.down'));
        down.addEventListener('click', () => move(i, 1));
        const show = createSwitch('', !hidden, (on) => void change((l) => ({ ...l, hidden: on ? l.hidden.filter((other) => other !== id) : [...l.hidden, id] }), `${id}:show`));
        show.setAttribute('aria-label', t('settings.library.show-row', { name }));
        show.dataset.focusId = `${id}:show`;
        controls.append(up, down, show);
        return h('li', { class: hidden ? 'home-row-item off' : 'home-row-item' }, renaming === id ? renameField(id, name, typed) :h('span', { class: 'home-row-name' }, name), controls);
      }),
    );
    // Rebuilding the list loses focus; put it back on the same control (or its row's other one at an end).
    const focus = pendingFocus ?? active;
    pendingFocus = null;
    if (focus === `${renaming}:name`) {
      const field = list.querySelector<HTMLInputElement>('.home-row-rename');
      if (field) beginEditing(field);
    } else if (focus) {
      // Row ids can hold colons themselves (catalog rows), so find the row by prefix.
      const rowId = order.find((id) => focus.startsWith(`${id}:`));
      const sameRow = rowId ? [...list.querySelectorAll<HTMLElement>('[data-focus-id]')].find((el) => el.dataset.focusId!.startsWith(`${rowId}:`) && !(el as HTMLButtonElement).disabled) : undefined;
      (list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focus)}"]:not(:disabled)`) ?? sameRow)?.focus();
    }
  }

  /** Renaming is explicit: Rename opens the field ready to type; Enter saves, Escape or leaving cancels. */
  function renameField(id: string, label: string, typed: string | undefined): HTMLInputElement {
    const own = typed ?? layout?.added.find((r) => r.id === id)?.name ?? '';
    const field = createTextField({
      label: t('homerows.rename-row', { name: label }),
      placeholder: label,
      className: 'home-row-rename',
      onSubmit: (value) => {
        renaming = null;
        const name = value.trim().slice(0, 60);
        void change((l) => ({ ...l, added: l.added.map((r) => (r.id === id ? (name ? { ...r, name } : { id: r.id, source: r.source }) : r)) }), `${id}:rename`);
      },
    });
    field.value = own;
    field.maxLength = 60;
    field.dataset.focusId = `${id}:name`;
    const cancel = () => {
      if (renaming !== id) return;
      renaming = null;
      pendingFocus = `${id}:rename`;
      draw();
    };
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    });
    field.addEventListener('blur', () => queueMicrotask(cancel));
    return field;
  }

  // ── Adding rows ──────────────────────────────────────────────────────

  const options = h('div', { class: 'chips home-add-options', role: 'group', 'aria-label': t('homerows.add.options') });
  let kind: Kind = 'catalog';
  /** For "Genre": the catalog picked first. */
  let genreOf: CatalogRef | null = null;
  let catalogs: Promise<CatalogRef[]> | null = null;
  let services: Promise<StreamingService[] | null> | null = null;

  function add(source: RowSource, name: string): void {
    const id = newRowId();
    const shown = knownRows().map((r) => r.id);
    void change((l) => ({
      ...l,
      added: [...l.added, { id, source }],
      // At the end of Home, after everything as it's arranged now.
      order: shown.length ? [...keepUnshown(arrange(shown, l.order), l.order), id] : [...l.order, id],
    })).then(() => {
      toast(t('homerows.added', { name }));
      void drawOptions();
    });
  }

  function chip(label: string, source: RowSource | null, onPick: () => void, hint?: string): HTMLButtonElement {
    const exists = !!source && !!layout?.added.some((r) => sameSource(r.source, source));
    const full = !!source && (layout?.added.length ?? 0) >= MAX_ADDED;
    const button = h('button', { class: 'chip', disabled: exists || full, ...(hint ? { title: hint } : {}) }, label);
    if (exists) button.setAttribute('aria-label', t('homerows.add.already', { name: label }));
    button.addEventListener('click', onPick);
    return button;
  }

  const message = (text: string) => h('p', { class: 'muted home-add-message' }, text);

  async function drawOptions(): Promise<void> {
    const showing = kind;
    let content: (HTMLElement | string)[];
    switch (kind) {
      case 'catalog': {
        const refs = await (catalogs ??= usableAddons().then(browsableCatalogs).catch(() => []));
        content = refs.length
          ? refs.map((ref) => {
              const label = t('browse.home.row-source', { row: railTitle(ref.catalog), source: ref.addon.manifest.name });
              const source: RowSource = { kind: 'catalog', addon: ref.addon.manifest.id, type: ref.catalog.type, catalog: ref.catalog.id };
              return chip(label, source, () => add(source, railTitle(ref.catalog)));
            })
          : [message(t('browse.home.no-catalogs'))];
        break;
      }
      case 'genre': {
        const refs = (await (catalogs ??= usableAddons().then(browsableCatalogs).catch(() => []))).filter((ref) => catalogGenres(ref).length);
        const picked = genreOf;
        if (picked) {
          const back = h('button', { class: 'chip home-add-back' }, t('homerows.add.back'));
          back.addEventListener('click', () => {
            genreOf = null;
            void drawOptions().then(() => options.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
          });
          content = [
            back,
            ...catalogGenres(picked).map((genre) => {
              const source: RowSource = { kind: 'catalog', addon: picked.addon.manifest.id, type: picked.catalog.type, catalog: picked.catalog.id, genre };
              const name = t('homerows.genre-of', { genre, row: railTitle(picked.catalog) });
              return chip(genre, source, () => add(source, name));
            }),
          ];
        } else {
          content = refs.length
            ? refs.map((ref) =>
                chip(t('browse.home.row-source', { row: railTitle(ref.catalog), source: ref.addon.manifest.name }), null, () => {
                  genreOf = ref;
                  void drawOptions().then(() => options.querySelector<HTMLElement>('.home-add-back')?.focus());
                }),
              )
            : [message(t('homerows.add.no-genres'))];
        }
        break;
      }
      case 'list': {
        const lists = customLists();
        content = lists.length ? lists.map((list) => chip(list.name, { kind: 'list', list: list.id }, () => add({ kind: 'list', list: list.id }, list.name))) : [message(t('homerows.add.no-lists'))];
        break;
      }
      case 'library':
        content = [chip(t('titles.common.my-library'), { kind: 'library' }, () => add({ kind: 'library' }, t('titles.common.my-library')))];
        break;
      case 'service': {
        // A failed lookup isn't "connect TMDB": say why, and ask again next time.
        const all = await (services ??= streamingServices()).catch((err: unknown) => ((services = null), { err }));
        if (all && 'err' in all) {
          content = [message(errorText(all.err, { service: 'tmdb' }))];
          break;
        }
        content = all?.length
          ? all.map((service) => chip(t('browse.home.popular-on', { name: service.name }), { kind: 'service', service: service.key }, () => add({ kind: 'service', service: service.key }, t('browse.home.popular-on', { name: service.name }))))
          : [message(t('homerows.add.no-services'))];
        break;
      }
      case 'collections': {
        await loadCollections();
        const all = { kind: 'collections' } as const;
        content = [
          chip(t('collections.row.all'), all, () => add(all, t('collections.row.title'))),
          ...collectionGroups().map((group) => chip(t('collections.row.group-label', { group }), { kind: 'collections', group }, () => add({ kind: 'collections', group }, group))),
        ];
        break;
      }
      case 'tiles': {
        const tiles: [RowSource, string, string][] = [
          [{ kind: 'status' }, t('homerows.status.label'), t('homerows.status.hint')],
          [{ kind: 'today' }, t('homerows.today.title'), t('homerows.today.hint')],
          [{ kind: 'live' }, t('homerows.live.title'), t('homerows.live.hint')],
        ];
        content = tiles.map(([source, name, hint]) => chip(name, source, () => add(source, name), hint));
        break;
      }
      case 'mood':
        content = MOODS.map((mood) => chip(moodLabel(mood), { kind: 'mood', mood }, () => add({ kind: 'mood', mood }, moodLabel(mood)), t(`homerows.mood.${mood}.hint`)));
        break;
      case 'jellyfin':
      case 'plex': {
        const own = kind;
        const server = own === 'plex' ? { status: plexStatus, libraries: plexLibraries } : { status: jellyfinStatus, libraries: jellyfinLibraries };
        if (!(await server.status())) {
          content = [message(t(`${own}.rows.not-connected`))];
          break;
        }
        const libraries = await server.libraries().catch(() => null);
        const feed = (source: RowSource & { kind: 'jellyfin' | 'plex' }, name: string) => chip(t(`${own}.rows.label`, { row: name }), source, () => add(source, name));
        content = [
          feed({ kind: own, feed: 'resume' }, t(`${own}.rows.resume`)),
          feed({ kind: own, feed: 'latest' }, t(`${own}.rows.latest`)),
          ...(libraries ?? []).map((library) => feed({ kind: own, feed: 'library', library: library.id }, library.name)),
          ...(libraries ? [] : [message(t(`${own}.rows.libraries-failed`))]),
        ];
        break;
      }
    }
    // A later choice of kind wins over this one, if it finished first.
    if (showing !== kind) return;
    const full = (layout?.added.length ?? 0) >= MAX_ADDED;
    // Keep focus where it was: an added chip turns disabled, so the nearest enabled one after it.
    const buttons = () => [...options.querySelectorAll<HTMLButtonElement>('button')];
    const focused = buttons().findIndex((b) => b === document.activeElement);
    options.replaceChildren(...content, ...(full ? [message(tn('homerows.add.full', MAX_ADDED))] : []));
    if (focused >= 0) {
      const after = buttons().slice(focused);
      (after.find((b) => !b.disabled) ?? buttons().reverse().find((b) => !b.disabled))?.focus();
    }
  }

  adder.append(
    h('h4', { class: 'home-add-heading' }, t('homerows.add.title')),
    choices(
      t('homerows.add.kind'),
      KINDS.map((k) => [k, KIND_LABELS[k]()] as const),
      kind,
      (next) => {
        kind = next;
        genreOf = null;
        void drawOptions();
      },
    ),
    options,
  );

  reset.addEventListener('click', () => void change(resetArrangement));
  // Home lists its rows once it has drawn them, and again after each change
  // (Settings keeps this panel, so it listens for as long as the app runs).
  // Settings builds the panel afresh on each redraw: the new one takes over
  // from the last, which would otherwise keep listening (and redrawing) unseen.
  rowsKnownListener?.abort();
  rowsKnownListener = new AbortController();
  document.addEventListener(
    HOME_ROWS_KNOWN,
    () => {
      draw();
      void drawOptions();
    },
    { signal: rowsKnownListener.signal },
  );
  void homeLayout().then((saved) => {
    layout = saved;
    draw();
    void drawOptions();
  });
  return section;
}
