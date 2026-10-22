/**
 * Live TV: channels from the person's IPTV sources (Settings → Live TV),
 * by group, as a list with what's on now and next, or as a guide grid. Choosing a channel
 * plays it; Rust turns the channel into its real address. In the Favourites
 * group, favourites can be put in order (see favourites-order.ts); the groups
 * themselves can be put in order, hidden or locked (see groups.ts).
 */
import { locale, t, tn } from '../../i18n';
import { gateLiveTv } from '../profiles/parental';
import { VIEW_SHOWN, type Room, type RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { withContextMenu } from '../../components/menu';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { h } from '../../lib/dom';
import { errorState, errorText, stateMessage } from '../../components/state-message';
import { settings } from '../../lib/ipc';
import {
  GROUP_ERRORS,
  lockTvGroups,
  onTvUpdated,
  refreshStaleTvSources,
  replayAddress,
  setTvFavourite,
  setTvFavouriteOrder,
  setTvGroup,
  setTvGroupOrder,
  tvChannels,
  tvGroups,
  tvGuide,
  TV_SOURCES_CHANGED,
  unlockTvGroups,
  type Showing,
  type TvChannel,
  type TvGroup,
  type TvGroups,
  type TvGuide,
} from '../../live/iptv';
import {
  channelLogo,
  channelRequest,
  channelTitle,
  clock,
  debounce,
  favouritesInOrder,
  LIVE_SETTINGS,
  loadLast,
  moveItem,
  parseOpenOn,
  progressBar,
  progressOf,
  rememberLast,
  sameChannel,
  setSurfing,
  type GroupRef,
} from '../../live/surf';
import { openPlayer } from '../player';
import { openSettingsTo } from '../settings';
import { searchNextFor } from '../search';
import { choices } from '../settings/playback';
import { enableDrag, reorderControls } from './favourites-order';
import { createGuideGrid } from './guide-grid';
import { groupEditor, lockPrompt } from './groups';
import { pageLife } from './page-life';
import './live.css';

/** Rows drawn at once in the list, and in the (heavier) guide grid; search narrows the rest. */
const SHOWN = 200;
const SHOWN_IN_GUIDE = 100;
/** 'list' (default) or 'guide', remembered. */
const VIEW_KEY = 'live.view';
type View = 'list' | 'guide';
const FAVOURITES = t('browse.live.favourites');
const ALL = t('browse.live.all');

/** Plays a channel; Up/Down in the player then surf through `list` (where it was picked from). */
export function playChannel(channel: TvChannel, ctx: RoomContext, list: readonly TvChannel[] | null = null): void {
  setSurfing(channel, list);
  openPlayer(channelRequest(channel), ctx);
}

/** A finished programme from the channel's archive, from the start (catch-up). */
export function replayProgramme(channel: TvChannel, programme: Showing, ctx: RoomContext): void {
  const title: Title = { ...channelTitle(channel), id: `tv:${channel.source}:${channel.key}:${programme.start}`, name: programme.title, ...(programme.description ? { description: programme.description } : {}) };
  const source = { id: 'replay', url: replayAddress(channel, programme), addon: channel.name, label: t('browse.live.catch-up'), meta: '' };
  openPlayer({ title, source, sources: [source], replay: true }, ctx);
}

/** A group's name to show. Groups are told apart by ref, so a provider's group named like "All channels" stays its own. */
const groupLabel = (ref: GroupRef): string => (ref === 'all' ? ALL : ref === 'favourites' ? FAVOURITES : ref.name);
const sameGroup = (a: GroupRef, b: GroupRef): boolean => (typeof a === 'string' || typeof b === 'string' ? a === b : a.name === b.name);
const groupFocusId = (ref: GroupRef): string => (typeof ref === 'string' ? `group:${ref}` : `group:name:${ref.name}`);

/** Saving the favourites' order waits for a pause, so a run of moves is one write. */
const SAVE_ORDER_MS = 400;
/** How long typing in the search pauses before the channels are filtered. */
const SEARCH_MS = 150;

export const liveRoom: Room = {
  id: 'live',
  label: t('browse.nav.live'),
  render(ctx) {
    // A profile's content limit can turn Live TV off.
    return gateLiveTv(ctx, () => livePage(ctx));
  },
  onShow() {
    void refreshStaleTvSources().catch(() => {});
  },
};

function livePage(ctx: RoomContext): HTMLElement {
  let channels: TvChannel[] = [];
  /** Every group as the profile arranges them (hidden and locked ones too). */
  let groupInfo: TvGroups = { groups: [], unlocked: false, pinSet: false };
  /** Whether the group list is being arranged (Edit groups). */
  let editing = false;
  let group: GroupRef = 'all';
  let query = '';
  let guide = new Map<string, TvGuide>();
  let shown: TvChannel[] = [];
  /** Every channel the group and search match, in order: what the player surfs through. */
  let matches: TvChannel[] = [];
  let view: View = 'list';
  let gridDrawnAt = 0;
  /** Settings → Live TV (which group, and whether to resume) apply the first time channels load. */
  let opened = false;
  /** Whether the channels and groups have been read at least once. */
  let loaded = false;

  const search = createTextField({ label: t('browse.live.search'), placeholder: t('browse.live.search'), onSubmit: () => {} });
  // Once typing pauses: each redraw filters every channel and asks Rust for the guide of
  // those shown, which with tens of thousands of channels made typing lag.
  const searchChanged = debounce(SEARCH_MS, () => {
    query = search.value.trim().toLowerCase();
    // Typing keeps the guide on the day and time being looked at.
    drawList(true);
  });
  search.addEventListener('input', () => searchChanged.call());
  const groups = h('nav', { class: 'live-groups', 'aria-label': t('browse.live.groups') });
  const list = h('div', { class: 'live-list', role: 'list' });
  enableDrag(list, (from, to) => moveFavourite(from, to));
  enableDrag(groups, (from, to) => moveGroup(from, to));
  const grid = createGuideGrid({
    onPlay: (c) => playChannel(c, ctx, matches),
    onReplay: (c, p) => replayProgramme(c, p, ctx),
    onSearch: (query) => {
      searchNextFor(query);
      ctx.go('search', { root: true });
    },
    onAddGuide: () => {
      openSettingsTo('livetv');
      ctx.go('settings');
    },
  });
  const note = h('p', { class: 'muted live-note' });
  const main = h('div', { class: 'live-main' }, list, note);
  // Until the channels are read (a moment, or longer with tens of thousands): placeholders, not an empty page.
  const skeletons = (count: number, className: string) => Array.from({ length: count }, () => h('div', { class: `skeleton ${className}`, 'aria-hidden': 'true' }));
  const body = h(
    'div',
    { class: 'live-body' },
    h('div', { class: 'live-groups' }, ...skeletons(6, 'live-group-skeleton')),
    h('div', { class: 'live-main' }, h('div', { class: 'live-list' }, ...skeletons(8, 'live-row-skeleton'))),
  );
  const nowButton = h('button', { class: 'button', hidden: true }, t('browse.live.now'));
  nowButton.addEventListener('click', () => void grid.scrollToNow());
  const viewSwitch = h('span', {});
  const tools = h('div', { class: 'live-tools' }, nowButton, viewSwitch, search);
  const page = h('div', { class: 'room live' }, h('div', { class: 'live-header' }, h('h1', { class: 'page-title' }, t('browse.nav.live')), tools), body);
  const life = pageLife(page);

  function setView(next: View): void {
    view = next;
    nowButton.hidden = view !== 'guide';
    main.replaceChildren(view === 'guide' ? grid.element : list, note);
    drawList();
  }
  void settings
    .get(VIEW_KEY)
    .catch(() => null)
    .then((saved) => {
      const initial: View = saved === 'guide' ? 'guide' : 'list';
      viewSwitch.replaceChildren(
        choices(t('browse.live.view'), [['list', t('browse.live.list')], ['guide', t('browse.live.guide')]] as const, initial, (v) => {
          setView(v);
          void settings.set(VIEW_KEY, v).catch(() => {});
        }),
      );
      if (initial !== view) setView(initial);
    });

  const id = (c: TvChannel) => `${c.source}/${c.key}`;

  /** A group that is locked and not opened this session: it shows the PIN prompt instead of channels. */
  const lockedNow = (ref: GroupRef) => typeof ref !== 'string' && !groupInfo.unlocked && groupInfo.groups.some((g) => g.name === ref.name && g.locked && !g.hidden);

  function groupButton(ref: GroupRef, count: number, info: TvGroup | undefined): HTMLElement {
    const name = groupLabel(ref);
    // A lock in place of the count while it's closed.
    const closed = Boolean(info?.locked) && !groupInfo.unlocked;
    const b = h(
      'button',
      { class: 'live-group', 'aria-current': String(sameGroup(ref, group)), 'data-focus-id': groupFocusId(ref) },
      h('span', { dir: 'auto' }, name),
      closed ? h('span', { class: 'count', title: t('livetv.groups.locked'), 'aria-label': t('livetv.groups.locked') }, icon('lock')) : h('span', { class: 'count' }, count.toLocaleString(locale())),
    );
    b.addEventListener('click', () => {
      group = ref;
      void rememberLast({ group: ref });
      drawGroups();
      drawList();
      // A new group starts at its first channel, not wherever the last one was scrolled to:
      // the list scrolls with the page, the guide's channels inside the guide.
      body.closest('.outlet')?.scrollTo({ top: 0 });
      body.querySelector('.guide-scroller')?.scrollTo({ top: 0 });
    });
    if (!info) return b;
    return withContextMenu(b, () => [
      { label: t('livetv.groups.hide', { name }), action: () => toggleHidden(info) },
      { label: t(info.locked ? 'livetv.groups.unlock' : 'livetv.groups.lock', { name }), action: () => toggleLocked(info) },
      { label: t('livetv.groups.edit'), action: () => setEditing(true) },
    ]);
  }

  function drawGroups(): void {
    const focused = document.activeElement instanceof HTMLElement && groups.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const rowsOf = () => [...groups.querySelectorAll<HTMLElement>('.live-group')];
    const focusedRow = focused?.startsWith('group:') ? rowsOf().findIndex((b) => b.dataset.focusId === focused) : -1;
    if (editing) {
      groups.replaceChildren(...groupEditor(groupInfo.groups, { move: moveGroup, toggleHidden, toggleLocked, done: () => setEditing(false) }));
    } else {
      const favourites = channels.filter((c) => c.favourite).length;
      const listed = groupInfo.groups.filter((g) => !g.hidden);
      const current = group;
      const stays = current === 'all' || (current === 'favourites' ? favourites > 0 : listed.some((g) => g.name === current.name));
      if (!stays) group = 'all';
      const edit = h('button', { class: 'button live-groups-tool', 'data-focus-id': 'groups:edit' }, icon('pencil'), t('livetv.groups.edit'));
      edit.addEventListener('click', () => setEditing(true));
      const tools = h('div', { class: 'live-groups-tools' }, edit);
      // Locked groups opened this session can be closed again without restarting.
      if (groupInfo.unlocked && listed.some((g) => g.locked)) {
        const relock = h('button', { class: 'button live-groups-tool', 'data-focus-id': 'groups:lock' }, icon('lock'), t('livetv.groups.lock-now'));
        relock.addEventListener('click', () => void lockTvGroups().then(() => load(true)).catch((err: unknown) => console.warn('Could not lock the groups again', err)));
        tools.append(relock);
      }
      groups.replaceChildren(
        tools,
        groupButton('all', channels.length, undefined),
        ...(favourites ? [groupButton('favourites', favourites, undefined)] : []),
        ...listed.map((g) => groupButton({ name: g.name }, g.count, g)),
      );
    }
    // Redrawn when a source refreshes too: focus stays on the same group, or
    // goes to the next one if that group left (hidden from its menu).
    const target = focused ? groups.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`) : null;
    const rows = target || focusedRow < 0 ? [] : rowsOf();
    (target ?? rows[Math.min(focusedRow, rows.length - 1)])?.focus({ preventScroll: true });
  }

  function setEditing(on: boolean): void {
    editing = on;
    body.classList.toggle('editing-groups', on);
    drawGroups();
    groups.querySelector<HTMLElement>(`[data-focus-id="${on ? 'groups:done' : 'groups:edit'}"]`)?.focus({ preventScroll: true });
  }

  /** An order moved to in the editor and not saved yet: a reload meanwhile (hiding or locking one) keeps it. */
  let unsavedGroupOrder: string[] | null = null;
  const saveGroupOrder = debounce(SAVE_ORDER_MS, (names: string[]) => {
    void setTvGroupOrder(names)
      .then(() => {
        if (unsavedGroupOrder === names) unsavedGroupOrder = null;
      })
      .catch(() => {
        unsavedGroupOrder = null;
        toast(t('livetv.groups.save-failed'));
        void load(true);
      });
  });

  /** Moves the group at `from` to `to` in the editor, keeping focus on what moved. */
  function moveGroup(from: number, to: number): void {
    if (to < 0 || to >= groupInfo.groups.length || from === to) return;
    const focused = document.activeElement instanceof HTMLElement && groups.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    groupInfo.groups = moveItem(groupInfo.groups, from, to);
    drawGroups();
    const moved = groupInfo.groups[to]!;
    if (focused?.startsWith(`edit-group:${moved.name}:`)) {
      const find = (focusId: string) => groups.querySelector<HTMLButtonElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
      // At the top or bottom its button is disabled: the other one takes focus.
      let target = find(focused);
      if (!target || target.disabled) target = find(`edit-group:${moved.name}:${to === 0 ? 'down' : 'up'}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }
    unsavedGroupOrder = groupInfo.groups.map((g) => g.name);
    saveGroupOrder.call(unsavedGroupOrder);
  }

  /** Saves a group's change, then reloads: what's listed is decided in Rust. */
  function changeGroup(info: TvGroup, change: { hidden?: boolean; locked?: boolean }): void {
    void setTvGroup(info.name, change)
      .then(() => load(true))
      .catch((err: unknown) => {
        if (String(err) === GROUP_ERRORS.noPin) toast(t('livetv.groups.no-pin'));
        // Taking a lock off needs the PIN first.
        else if (String(err) === GROUP_ERRORS.pinNeeded) askPin(() => changeGroup(info, change));
        else toast(t('livetv.groups.save-failed'));
      });
  }

  const toggleHidden = (info: TvGroup) => changeGroup(info, { hidden: !info.hidden });
  const toggleLocked = (info: TvGroup) => changeGroup(info, { locked: !info.locked });

  /**
   * The PIN prompt is up for a change asked for (taking a lock off), not for the group shown:
   * redraws that only refresh (a source updating, the guide moving on, a search) leave it be.
   */
  let askingPin = false;

  /** Shows the PIN prompt where the channels go; `then` runs once the groups are open (else they reload). */
  function askPin(then?: () => void): void {
    askingPin = Boolean(then);
    main.replaceChildren(
      lockPrompt(
        groupInfo.pinSet,
        async (pin) => {
          await unlockTvGroups(pin);
          askingPin = false;
          if (then) then();
          else await load(true);
        },
        () => {
          askingPin = false;
          // Escape: back to all channels (a locked group has nothing else to show).
          if (lockedNow(group)) group = 'all';
          drawGroups();
          drawList();
          groups.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
        },
      ),
    );
  }

  /** Favourites can be put in order while they're all listed (not narrowed by a search). */
  const reordering = () => group === 'favourites' && !query && view === 'list';

  function row(c: TvChannel, index: number): HTMLElement {
    const g = guide.get(id(c));
    const play = h(
      'button',
      { class: 'live-row', title: g?.now?.description ?? c.name, 'data-focus-id': `${id(c)}:play` },
      channelLogo(c),
      h(
        'span',
        { class: 'live-text' },
        h('span', { class: 'live-name', dir: 'auto' }, c.name),
        g?.now ? h('span', { class: 'live-now', dir: 'auto' }, g.now.title) : h('span', { class: 'live-now muted', dir: 'auto' }, c.group ?? ''),
        g?.now ? progressBar(progressOf(g.now)) : '',
      ),
      h('span', { class: 'live-next muted' }, g?.next ? t('browse.live.next', { time: clock(g.next.start), title: g.next.title }) : ''),
    );
    play.addEventListener('click', () => playChannel(c, ctx, matches));
    const star = h('button', { class: 'live-star', 'data-focus-id': `${id(c)}:star`, 'aria-pressed': String(c.favourite), title: c.favourite ? t('browse.live.unfavourite') : t('browse.live.favourite'), 'aria-label': t('browse.live.favourite-channel', { name: c.name }) }, icon('star'));
    star.addEventListener('click', () => {
      const on = !c.favourite;
      void setTvFavourite(c, on)
        .then(() => {
          c.favourite = on;
          // New favourites go last, as Rust puts them.
          c.rank = on ? channels.reduce((last, other) => (other.favourite && other !== c ? Math.max(last, other.rank ?? 0) : last), -1) + 1 : null;
          drawGroups();
          drawList();
        })
        .catch((err: unknown) => toast(errorText(err)));
    });
    // The item is the list's entry; the button inside keeps its button role.
    if (!reordering()) return h('div', { class: 'live-item', role: 'listitem' }, play, star);
    const { grip, buttons } = reorderControls(c.name, id(c), index, matches.length, (to) => moveFavourite(index, to));
    return h('div', { class: 'live-item reorder', role: 'listitem' }, grip, play, buttons, star);
  }

  /** Favourites moved and not saved yet: a reload meanwhile (a source refreshing) keeps their order. */
  let unsavedFavouriteOrder: TvChannel[] | null = null;
  const saveOrder = debounce(SAVE_ORDER_MS, (ordered: TvChannel[]) => {
    void setTvFavouriteOrder(ordered)
      .then(() => {
        if (unsavedFavouriteOrder === ordered) unsavedFavouriteOrder = null;
      })
      .catch(() => {
        unsavedFavouriteOrder = null;
        toast(t('livetv.favourites.save-failed'));
        void load();
      });
  });

  /** Moves the favourite at `from` to `to`, keeping focus on what moved. */
  function moveFavourite(from: number, to: number): void {
    const favourites = favouritesInOrder(channels);
    if (to < 0 || to >= favourites.length || from === to) return;
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const ordered = moveItem(favourites, from, to);
    ordered.forEach((c, i) => (c.rank = i));
    drawList();
    if (focused) {
      const find = (focusId: string) => list.querySelector<HTMLButtonElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
      // At the top or bottom its button is disabled: the other one takes focus.
      let target = find(focused);
      if (!target || target.disabled) target = find(`${id(ordered[to]!)}:${to === 0 ? 'down' : 'up'}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }
    unsavedFavouriteOrder = ordered;
    saveOrder.call(ordered);
  }

  /** `keep`: a refresh, which leaves the guide where the person was looking rather than going back to now. */
  function drawList(keep = false): void {
    // Not before the channels first arrive (the saved view or a search can come sooner): no channels yet isn't "every group hidden".
    if (!loaded) return;
    if (askingPin && keep && main.querySelector('.live-locked')) return;
    askingPin = false;
    if (lockedNow(group)) {
      shown = [];
      // A refresh or search while it's asked keeps the prompt (and what's typed in it).
      if (!main.querySelector('.live-locked')) askPin();
      return;
    }
    const current = group;
    const inGroup = current === 'favourites' ? favouritesInOrder(channels) : channels.filter((c) => current === 'all' || c.group === current.name);
    matches = inGroup.filter((c) => !query || c.name.toLowerCase().includes(query));
    if (query && !matches.length) {
      shown = [];
      note.textContent = '';
      main.replaceChildren(stateMessage({ icon: 'search', title: t('browse.live.no-match', { query: search.value.trim() }) }), note);
      return;
    }
    // Every channel in hidden groups, or locked ones not opened: say why the page is empty, and where to change it.
    if (!matches.length) {
      shown = [];
      note.textContent = '';
      const edit = h('button', { class: 'button primary' }, t('livetv.groups.edit'));
      edit.addEventListener('click', () => setEditing(true));
      main.replaceChildren(stateMessage({ icon: 'tv', title: t('livetv.groups.none-title'), detail: t('livetv.groups.none-body'), action: edit }), note);
      return;
    }
    // Back from the PIN prompt or a search that found nothing: the channels (or the grid) return.
    const content = view === 'guide' ? grid.element : list;
    if (!main.contains(content)) main.replaceChildren(content, note);
    const limit = view === 'guide' ? SHOWN_IN_GUIDE : SHOWN;
    // Many providers' guides cover only some channels; the grid lists those first.
    if (view === 'guide') matches.sort((a, b) => Number(b.listed) - Number(a.listed));
    shown = matches.slice(0, limit);
    note.textContent = matches.length > limit ? tn('browse.live.showing', matches.length, { limit }) : '';
    if (view === 'guide') {
      gridDrawnAt = Date.now();
      void grid.render(shown).then(() => (keep ? undefined : grid.scrollToNow()));
      return;
    }
    drawRows();
    void loadGuide();
  }

  /** Redraws the rows, keeping focus on the same control (e.g. while moving a favourite). */
  function drawRows(): void {
    const active = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
    const focused = active?.dataset.focusId;
    const items = () => [...list.querySelectorAll<HTMLElement>('.live-item')];
    const at = active ? items().findIndex((item) => item.contains(active)) : -1;
    list.replaceChildren(...shown.map(row));
    if (!focused) return;
    const target = list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`);
    if (target) return target.focus({ preventScroll: true });
    // Its row left (a favourite unstarred): the row that took its place, on the same control.
    const near = at < 0 ? undefined : items()[Math.min(at, items().length - 1)];
    const control = focused.slice(focused.lastIndexOf(':'));
    (near?.querySelector<HTMLElement>(`[data-focus-id$="${CSS.escape(control)}"]`) ?? near?.querySelector<HTMLElement>('.live-row'))?.focus({ preventScroll: true });
  }

  async function loadGuide(): Promise<void> {
    const want = shown;
    const found = await tvGuide(want).catch(() => [] as TvGuide[]);
    if (want !== shown) return;
    guide = new Map(found.map((g) => [`${g.source}/${g.key}`, g]));
    // Not under a favourite being dragged: its grip would be replaced and the drop lost (the next minute catches up).
    if (!list.querySelector('.live-item.dragging')) drawRows();
  }

  /** The first time: Settings → Live TV's group, then the last channel if it's to resume. */
  async function opening(): Promise<TvChannel | null> {
    const [openOn, resume, last] = await Promise.all([settings.get(LIVE_SETTINGS.openOn).catch(() => null), settings.get(LIVE_SETTINGS.resumeLast).catch(() => null), loadLast()]);
    const choice = parseOpenOn(openOn);
    if (choice === 'favourites') group = 'favourites';
    else if (choice === 'last' && last.group) group = last.group;
    const channel = last.channel;
    return (resume === true && channel && channels.find((c) => sameChannel(c, channel))) || null;
  }

  async function load(refresh = false): Promise<void> {
    const current = life.begin();
    try {
      const [nextChannels, nextGroups] = await Promise.all([tvChannels(), tvGroups()]);
      // A later reload (a source refreshing meanwhile) has the newer list.
      if (!current()) return;
      [channels, groupInfo] = [nextChannels, nextGroups];
      loaded = true;
      if (unsavedGroupOrder) {
        const rank = new Map(unsavedGroupOrder.map((name, i) => [name, i]));
        groupInfo.groups = [...groupInfo.groups].sort((a, b) => (rank.get(a.name) ?? rank.size) - (rank.get(b.name) ?? rank.size));
      }
      if (unsavedFavouriteOrder) {
        const rank = new Map(unsavedFavouriteOrder.map((c, i) => [id(c), i]));
        favouritesInOrder(channels)
          .sort((a, b) => (rank.get(id(a)) ?? rank.size) - (rank.get(id(b)) ?? rank.size))
          .forEach((c, i) => (c.rank = i));
      }
    } catch (err) {
      if (!current()) return;
      // Not "add a source": the sources are there, they just couldn't be read.
      console.warn('Could not load the channels', err);
      body.replaceChildren(errorState({ title: t('states.live.failed'), err, retry: () => void load(refresh), go: ctx.go, service: 'iptv' }));
      return;
    }
    const resume = channels.length && !opened ? await opening() : null;
    if (!current()) return;
    if (channels.length) opened = true;
    // Every channel may be in hidden or locked groups: the groups still show.
    if (!channels.length && !groupInfo.groups.length) {
      const add = h('button', { class: 'button primary' }, t('browse.live.add-source'));
      add.addEventListener('click', () => {
        openSettingsTo('livetv');
        ctx.go('settings');
      });
      body.replaceChildren(stateMessage({ icon: 'tv', title: t('states.live.empty-title'), detail: t('browse.live.empty'), action: add }));
      return;
    }
    if (!body.contains(groups)) body.replaceChildren(groups, main);
    drawGroups();
    drawList(refresh);
    if (resume && page.isConnected) playChannel(resume, ctx, matches.some((c) => sameChannel(c, resume)) ? matches : null);
  }

  void load();
  // A source refreshed: reload now, or when the page is next shown if it's away.
  let stale = false;
  const sourceChanged = () => {
    if (page.isConnected) void load(true);
    else stale = true;
  };
  life.track(onTvUpdated(sourceChanged));
  // Removing a source (Settings → Live TV) sends no update from Rust: without this its channels stayed listed.
  document.addEventListener(TV_SOURCES_CHANGED, sourceChanged);
  life.onDiscard(() => document.removeEventListener(TV_SOURCES_CHANGED, sourceChanged));
  // What's on changes: every minute the list refreshes and the grid moves its
  // "now" line; the grid is redrawn every 15 minutes so its window moves on.
  // Not while the window is minimised or in the tray; it catches up on return.
  const refreshNow = () => {
    if (!page.isConnected || document.hidden) return;
    if (view === 'list') void loadGuide();
    else if (Date.now() - gridDrawnAt > 15 * 60_000) drawList(true);
    else grid.tick();
  };
  const ticking = window.setInterval(refreshNow, 60_000);
  document.addEventListener('visibilitychange', refreshNow);
  life.onDiscard(() => {
    window.clearInterval(ticking);
    document.removeEventListener('visibilitychange', refreshNow);
  });
  page.addEventListener(VIEW_SHOWN, () => {
    if (stale) {
      stale = false;
      void load(true);
    }
    // As the minute's refresh would: a grid left for over 15 minutes moves its window on.
    else refreshNow();
  });
  return page;
}
