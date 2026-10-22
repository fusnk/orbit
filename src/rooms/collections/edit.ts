/**
 * Making or editing a custom collection: its name and group, cover and tile
 * shape, and what's in it — titles added from their menus, or sources (an
 * installed addon's catalog, or a TMDB collection, list, company, network or
 * person). Nothing is saved until Save.
 */
import { markActivity } from '../../app/activity';
import type { RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import { railTitle } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { beginEditing, createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { catalogRefFor, sourcePager, sourceStatus, type SourceContext } from '../../library/collection-sources';
import {
  createCollection,
  deleteCollection,
  findCollection,
  isHttpsUrl,
  MAX_NAME,
  MAX_SOURCES,
  SHAPES,
  TMDB_ID_KINDS,
  TMDB_SORTS,
  updateCollection,
  type CollectionDraft,
  type CollectionSource,
  type Shape,
  type TmdbKind,
} from '../../library/collections';
import { choices } from '../settings/playback';
import { createCollectionPage } from './page';
import { sourceContext, sourceName, statusText, tmdbHint, tmdbKindLabel } from './parts';
import './collections.css';
import { errorText } from '../../components/state-message';

type Mode = 'titles' | 'sources';
const SHAPE_LABELS: Record<Shape, () => string> = { poster: () => t('collections.edit.shape-poster'), landscape: () => t('collections.edit.shape-landscape'), square: () => t('collections.edit.shape-square') };
const TMDB_PATH: Record<string, TmdbKind> = { collection: 'collection', list: 'list', company: 'company', network: 'network', person: 'person' };

/**
 * A TMDB id typed as a number, or taken from a TMDB address
 * ("https://www.themoviedb.org/collection/10-star-wars-collection"), with the
 * kind the address names, else the one `chosen`. A director's address is a
 * person page, so a person address keeps Director when that was chosen.
 */
export function readTmdbId(text: string, chosen: TmdbKind): { id: number; kind: TmdbKind } | null {
  const value = text.trim();
  if (/^\d{1,10}$/.test(value)) return Number(value) > 0 ? { id: Number(value), kind: chosen } : null;
  const match = /^https:\/\/(?:www\.)?themoviedb\.org\/(collection|list|company|network|person)\/(\d{1,10})(?:[-/?#]|$)/.exec(value);
  if (!match) return null;
  const id = Number(match[2]);
  const kind = TMDB_PATH[match[1]!]!;
  return id > 0 ? { id, kind: kind === 'person' && chosen === 'director' ? 'director' : kind } : null;
}

/** `id` null: a new collection. */
export function createCollectionEditor(id: string | null, ctx: RoomContext): HTMLElement {
  const existing = id ? findCollection(id) : undefined;
  const draft: CollectionDraft & { shape: Shape } = {
    name: existing?.name ?? '',
    group: existing?.group,
    cover: existing?.cover,
    backdrop: existing?.backdrop,
    shape: existing?.shape ?? 'poster',
    sources: [...(existing?.sources ?? [])],
  };
  let mode: Mode = draft.sources.length ? 'sources' : 'titles';
  let context: SourceContext = { addons: [], tmdb: false };

  const message = h('p', { class: 'status', role: 'status' });
  const name = createTextField({ label: t('collections.edit.name'), placeholder: t('collections.edit.name-placeholder'), onSubmit: () => void save() });
  name.value = draft.name;
  name.maxLength = MAX_NAME;
  const group = createTextField({ label: t('collections.edit.group'), placeholder: t('collections.edit.group-placeholder'), onSubmit: () => void save() });
  group.value = draft.group ?? '';
  group.maxLength = MAX_NAME;
  const cover = createTextField({ label: t('collections.edit.cover'), placeholder: 'https://…', onSubmit: () => setCover(cover.value) });
  cover.type = 'url';
  cover.value = draft.cover ?? '';
  const preview = h('span', { class: 'collection-cover-preview' });
  const picks = h('div', { class: 'collection-cover-picks', hidden: true });
  const sourcesBody = h('div', { class: 'collection-sources' });

  function setCover(value: string): void {
    const url = value.trim();
    if (url && !isHttpsUrl(url)) {
      message.textContent = t('collections.edit.cover-https');
      return;
    }
    message.textContent = '';
    draft.cover = url || undefined;
    cover.value = url;
    drawPreview();
  }

  function drawPreview(): void {
    preview.className = `collection-cover-preview ${draft.shape}`;
    preview.replaceChildren(draft.cover ? artImage(draft.cover, 'art') : h('span', { class: 'muted' }, t('collections.edit.no-cover')));
  }

  /** Posters and backdrops of its first titles, to pick one as the cover. */
  async function pickCover(): Promise<void> {
    picks.hidden = false;
    picks.replaceChildren(h('p', { class: 'muted' }, t('collections.edit.cover-loading')));
    let titles: Title[] = existing && !existing.sources.length ? existing.titles : [];
    const first = draft.sources.find((s) => sourceStatus(s, context).state === 'ok');
    if (mode === 'sources' && first) titles = (await sourcePager(first, context).next().catch(() => ({ titles: [] as Title[] }))).titles;
    // Each picture named by its title and kind, so the buttons can be told apart without seeing them.
    const named = new Map<string, string>();
    for (const title of titles.slice(0, 12)) {
      if (title.poster && isHttpsUrl(title.poster) && !named.has(title.poster)) named.set(title.poster, t('collections.edit.use-poster', { name: title.name }));
      if (title.background && isHttpsUrl(title.background) && !named.has(title.background)) named.set(title.background, t('collections.edit.use-backdrop', { name: title.name }));
    }
    const urls = [...named.keys()];
    picks.replaceChildren(
      ...(urls.length
        ? urls.map((url) => {
            const button = h('button', { class: 'collection-cover-pick', 'aria-label': named.get(url)! }, artImage(url, 'art'));
            button.addEventListener('click', () => {
              setCover(url);
              picks.hidden = true;
              pick.focus({ preventScroll: true });
            });
            return button;
          })
        : [h('p', { class: 'muted' }, t('collections.edit.cover-none-found'))]),
    );
    picks.querySelector('button')?.focus();
  }

  const useCover = h('button', { class: 'button' }, t('collections.edit.cover-use'));
  useCover.addEventListener('click', () => setCover(cover.value));
  const pick = h('button', { class: 'button' }, t('collections.edit.cover-pick'));
  pick.addEventListener('click', () => void pickCover());
  const clear = h('button', { class: 'button' }, t('collections.edit.cover-clear'));
  clear.addEventListener('click', () => setCover(''));

  // ── Sources ──

  let adding: 'addon' | 'tmdb' | null = null;
  const adder = h('div', { class: 'collection-source-adder' });

  function drawSources(): void {
    if (mode === 'titles') {
      sourcesBody.replaceChildren(h('p', { class: 'muted' }, t('collections.edit.titles-intro')));
      return;
    }
    const rows = draft.sources.map((source, i) => {
      const status = sourceStatus(source, context);
      const remove = h('button', { class: 'button', 'aria-label': t('collections.edit.remove-source-named', { name: sourceName(source, context) }) }, t('collections.edit.remove-source'));
      remove.addEventListener('click', () => {
        draft.sources.splice(i, 1);
        drawSources();
        sourcesBody.querySelector<HTMLElement>('.collection-source-row button, .collection-add-kinds button')?.focus();
      });
      return h('li', { class: `collection-source-row ${status.state}` }, h('span', { class: 'collection-source-name' }, sourceName(source, context)), h('span', { class: 'muted' }, statusText(status)), remove);
    });
    const kinds = choices(
      t('collections.edit.add-source'),
      [
        ['addon', t('collections.edit.kind-addon')],
        ['tmdb', t('collections.edit.kind-tmdb')],
      ] as const,
      adding,
      (kind) => {
        adding = kind;
        drawAdder();
      },
    );
    kinds.classList.add('collection-add-kinds');
    sourcesBody.replaceChildren(
      rows.length ? h('ul', { class: 'collection-source-list' }, ...rows) : h('p', { class: 'muted' }, t('collections.edit.no-sources')),
      draft.sources.length < MAX_SOURCES ? h('div', {}, h('h4', { class: 'home-add-heading' }, t('collections.edit.add-source')), kinds, adder) : h('p', { class: 'muted' }, t('collections.edit.sources-full')),
    );
    drawAdder();
  }

  function addSource(source: CollectionSource): void {
    if (draft.sources.some((s) => JSON.stringify(s) === JSON.stringify(source))) return void toast(t('collections.edit.source-exists'));
    draft.sources.push(source);
    toast(t('collections.edit.source-added', { name: sourceName(source, context) }));
    drawSources();
    // The control pressed went with the redraw: focus goes back to the kind of source being added (or, when full, the list).
    (sourcesBody.querySelector<HTMLElement>('.collection-add-kinds [aria-pressed="true"]') ?? sourcesBody.querySelector<HTMLElement>('.collection-source-row:last-child button'))?.focus({ preventScroll: true });
  }

  /** For an addon catalog with genres: the catalog picked first. */
  let genreOf: { addon: string; type: string; catalog: string; addonName: string; label: string; genres: string[] } | null = null;

  function drawAdder(): void {
    if (adding === 'addon') {
      const picked = genreOf;
      if (picked) {
        const back = h('button', { class: 'chip home-add-back' }, t('homerows.add.back'));
        back.addEventListener('click', () => {
          genreOf = null;
          drawAdder();
        });
        const chip = (label: string, genre: string | undefined) => {
          const button = h('button', { class: 'chip' }, label);
          button.addEventListener('click', () => {
            genreOf = null;
            addSource({ kind: 'addon', addon: picked.addon, type: picked.type, catalog: picked.catalog, genre, addonName: picked.addonName, label: genre ? t('homerows.genre-of', { genre, row: picked.label }) : picked.label });
          });
          return button;
        };
        adder.replaceChildren(h('div', { class: 'chips' }, back, chip(t('collections.edit.all-genres'), undefined), ...picked.genres.map((g) => chip(g, g))));
        return;
      }
      const catalogs = context.addons.flatMap((addon) =>
        addon.manifest.catalogs.flatMap((catalog) => {
          const ref = catalogRefFor({ addon, catalog }, undefined);
          return ref ? [{ addon, catalog }] : [];
        }),
      );
      adder.replaceChildren(
        catalogs.length
          ? h(
              'div',
              { class: 'chips' },
              ...catalogs.map(({ addon, catalog }) => {
                const label = railTitle(catalog);
                const button = h('button', { class: 'chip' }, t('browse.home.row-source', { row: label, source: addon.manifest.name }));
                const genres = catalog.extra.find((e) => e.name === 'genre')?.options ?? [];
                button.addEventListener('click', () => {
                  const base = { addon: addon.manifest.id, type: catalog.type, catalog: catalog.id, addonName: addon.manifest.name, label };
                  if (genres.length) {
                    genreOf = { ...base, genres };
                    drawAdder();
                    adder.querySelector<HTMLElement>('.home-add-back')?.focus();
                  } else addSource({ kind: 'addon', ...base, genre: undefined });
                });
                return button;
              }),
            )
          : h('p', { class: 'muted' }, t('browse.home.no-catalogs')),
      );
    } else if (adding === 'tmdb') {
      drawTmdbAdder();
    } else adder.replaceChildren();
  }

  function drawTmdbAdder(): void {
    let kind: TmdbKind = 'collection';
    let media: 'movie' | 'tv' = 'movie';
    let sort: (typeof TMDB_SORTS)[number] = 'original';
    const field = createTextField({ label: t('collections.edit.tmdb-id'), placeholder: t('collections.edit.tmdb-id-placeholder'), onSubmit: () => add() });
    const add = () => {
      const read = readTmdbId(field.value, kind);
      if (!read) return void (message.textContent = t('collections.edit.tmdb-id-invalid'));
      message.textContent = '';
      const pickedKind = read.kind;
      addSource({ kind: 'tmdb', tmdb: pickedKind, id: read.id, media: pickedKind === 'network' ? 'tv' : media, sort: sort === 'original' ? undefined : sort, filters: undefined, label: undefined });
    };
    const addButton = h('button', { class: 'button primary' }, t('collections.edit.add'));
    addButton.addEventListener('click', add);
    adder.replaceChildren(
      context.tmdb ? '' : tmdbHint(ctx, { always: true }),
      h('p', { class: 'muted' }, t('collections.edit.tmdb-intro')),
      choices(t('collections.edit.tmdb-kind'), TMDB_ID_KINDS.map((k) => [k, tmdbKindLabel(k)] as const), kind, (k) => (kind = k)),
      choices(
        t('collections.edit.media'),
        [
          ['movie', t('browse.search.movies')],
          ['tv', t('browse.search.series')],
        ] as const,
        media,
        (m) => (media = m),
      ),
      choices(
        t('collections.edit.sort'),
        [
          ['original', t('collections.edit.sort-original')],
          ['popularity.desc', t('collections.edit.sort-popular')],
          ['vote_average.desc', t('collections.edit.sort-rating')],
          ['primary_release_date.desc', t('collections.edit.sort-newest')],
        ] as const,
        sort,
        (s) => (sort = s),
      ),
      h('div', { class: 'install-row' }, field, addButton),
    );
  }

  // ── Save, delete ──

  /** A second press while saving would create the collection twice. */
  let saving = false;
  async function save(): Promise<void> {
    if (saving) return;
    draft.name = name.value;
    draft.group = group.value.trim() || undefined;
    if (cover.value.trim() !== (draft.cover ?? '')) setCover(cover.value);
    // A refused address stops the save, also when it would replace a cover already set.
    if (cover.value.trim() !== (draft.cover ?? '')) return;
    if (!draft.name.trim()) {
      message.textContent = t('collections.edit.name-needed');
      return beginEditing(name);
    }
    if (mode === 'sources' && !draft.sources.length) {
      message.textContent = t('collections.edit.sources-needed');
      return;
    }
    const sending: CollectionDraft = { ...draft, sources: mode === 'sources' ? draft.sources : [] };
    saving = true;
    try {
      if (id) {
        await updateCollection(id, sending);
        toast(t('collections.edit.saved', { name: draft.name.trim() }));
        ctx.back();
      } else {
        const created = await createCollection(sending);
        toast(t('collections.edit.created', { name: draft.name.trim() }));
        ctx.back();
        ctx.open(createCollectionPage(created, ctx));
      }
    } catch (err) {
      message.textContent = errorText(err);
    } finally {
      saving = false;
    }
  }

  const saveButton = h('button', { class: 'button primary', 'data-autofocus': true }, t('collections.edit.save'));
  saveButton.addEventListener('click', () => void save());
  const cancel = h('button', { class: 'button glass' }, t('titles.common.cancel'));
  cancel.addEventListener('click', () => ctx.back());
  // Two-step delete: the first press arms it, leaving the button disarms it.
  const remove = h('button', { class: 'button danger' }, t('collections.edit.delete'));
  remove.addEventListener('click', () => {
    if (!id) return;
    if (!remove.dataset.armed) {
      remove.dataset.armed = 'true';
      remove.textContent = t('collections.edit.delete-confirm', { name: existing?.name ?? '' });
      return;
    }
    void deleteCollection(id)
      .then(() => {
        toast(t('collections.edit.deleted', { name: existing?.name ?? '' }));
        // Back past the editor; the collection's page closes itself once it's gone.
        ctx.back();
      })
      .catch((err: unknown) => (message.textContent = errorText(err)));
  });
  remove.addEventListener('blur', () => {
    delete remove.dataset.armed;
    remove.textContent = t('collections.edit.delete');
  });

  const modeChoice = choices(
    t('collections.edit.contents'),
    [
      ['titles', t('collections.edit.mode-titles')],
      ['sources', t('collections.edit.mode-sources')],
    ] as const,
    mode,
    (next) => {
      mode = next;
      drawSources();
    },
  );
  const shapeChoice = choices(
    t('collections.edit.shape'),
    SHAPES.map((s) => [s, SHAPE_LABELS[s]()] as const),
    draft.shape,
    (s) => {
      draft.shape = s;
      drawPreview();
    },
  );

  const field = (label: string, control: HTMLElement, hint?: string) => h('div', { class: 'collection-field' }, h('span', { class: 'setting-label' }, label), hint ? h('span', { class: 'muted' }, hint) : '', control);
  const page = h(
    'div',
    { class: 'collection-editor' },
    h('span', { class: 'eyebrow' }, t('collections.page.eyebrow')),
    h('h1', { class: 'page-title' }, id ? t('collections.edit.title-edit') : t('collections.edit.title-new')),
    field(t('collections.edit.name'), name),
    field(t('collections.edit.group'), group, t('collections.edit.group-hint')),
    field(t('collections.edit.cover'), h('div', { class: 'collection-cover-row' }, preview, h('div', { class: 'collection-cover-controls' }, h('div', { class: 'install-row' }, cover, useCover), h('div', { class: 'actions' }, pick, clear), picks)), t('collections.edit.cover-hint')),
    field(t('collections.edit.shape'), shapeChoice),
    field(t('collections.edit.contents'), h('div', {}, modeChoice, sourcesBody)),
    message,
    h('div', { class: 'hero-actions' }, saveButton, cancel, id ? remove : ''),
  );
  markActivity(page, t('collections.activity'));
  drawPreview();
  drawSources();
  void sourceContext().then((found) => {
    context = found;
    drawSources();
  });
  return page;
}
