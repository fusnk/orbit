/**
 * Settings → Live TV: the person's own IPTV sources. Orbit includes no
 * channels and suggests no providers. Addresses and logins go to Rust, which
 * checks them by downloading the channel list and keeps them encrypted; this
 * page only ever sees a source's name and host.
 */
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t, tn } from '../../i18n';
import { agoText } from '../../lib/ago';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { addTvSource, onTvUpdated, refreshTvSource, removeTvSource, tvSources, type NewTvSource, type TvSource } from '../../live/iptv';
import { parseVodSources, setVodEnabled, VOD_SOURCES_KEY } from '../../live/vod';
import { LIVE_SETTINGS, parseOpenOn } from '../../live/surf';
import { accountLine, guidesPanel } from './live-tv-extras';
import { choices, row, save } from './playback';
import { createSourceCheck } from './source-check';
import { classify, errorText } from '../../components/state-message';

/** "3 hours ago", "just now". */
function ago(ms: number | null): string {
  if (!ms) return t('integrations.live-tv.never');
  return agoText(ms, Date.now(), locale()) ?? t('integrations.live-tv.just-now');
}

/**
 * The newest panel's redraw, for the one update listener. The Accounts page is built
 * again (a reset, a setting it shows saved elsewhere) and the old panel is dropped for
 * good, while the newest one only leaves the page for a while (another category, another
 * page) and comes back: a listener per panel kept every dropped panel alive and drawing.
 */
let redrawLatest: (() => void) | undefined;
let listening = false;

export function liveTvPanel(): HTMLElement {
  const list = h('div', { class: 'tv-sources' });
  const panel = h(
    'div',
    {},
    h(
      'p',
      { class: 'muted settings-intro' },
      t('integrations.live-tv.intro'),
    ),
    list,
    vodSettings(),
    openingSettings(),
    addForm(() => void draw()),
  );

  // Draws can overlap (a refresh ending, a guide arriving, a removal); only the latest is shown.
  let drawn = 0;
  /** Sources whose guides are open, kept across redraws (a guide finishing redraws the list). */
  const openGuides = new Map<string, HTMLElement>();
  async function draw(): Promise<void> {
    const generation = ++drawn;
    let failed: unknown = null;
    const sources = await tvSources().catch((err: unknown) => ((failed = err ?? 'failed'), [] as TvSource[]));
    if (generation !== drawn) return;
    // A list that couldn't be read isn't "No sources yet".
    if (failed !== null) {
      const retry = h('button', { class: 'button' }, t('browse.search.retry'));
      retry.addEventListener('click', () => void draw());
      list.replaceChildren(h('p', { class: 'muted' }, errorText(failed, { service: 'iptv' })), retry);
      return;
    }
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
    for (const id of openGuides.keys()) if (!sources.some((s) => s.id === id)) openGuides.delete(id);
    list.replaceChildren(
      ...(sources.length ? sources.map(sourceRow) : [h('p', { class: 'muted' }, t('integrations.live-tv.empty'))]),
    );
    // Focus stays where it was: in a kept guides panel, or on the same button of a redrawn row.
    if (focused && !focused.isConnected && focused.dataset.focusId) list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused.dataset.focusId)}"]`)?.focus({ preventScroll: true });
    else if (focused?.isConnected) focused.focus({ preventScroll: true });
  }

  function sourceRow(source: TvSource): HTMLElement {
    // Ids so a redraw (a guide finishing in the background) keeps focus on the same button.
    const refresh = h('button', { class: 'button', 'data-focus-id': `refresh:${source.id}` }, t('integrations.live-tv.refresh'));
    refresh.addEventListener('click', () => {
      refresh.disabled = true;
      refresh.textContent = t('integrations.live-tv.refreshing');
      void refreshTvSource(source.id)
        .then(() => toast(t('integrations.live-tv.refreshed', { name: source.name })))
        .catch((err: unknown) => toast(errorText(err, { service: 'iptv' })))
        .finally(
          () =>
            void draw().then(() => {
              // Disabling the button while it ran dropped focus: back on it, unless the person has moved on.
              if (document.activeElement === document.body) list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(`refresh:${source.id}`)}"]`)?.focus({ preventScroll: true });
            }),
        );
    });
    const remove = h('button', { class: 'button danger', 'data-focus-id': `remove:${source.id}` }, t('integrations.common.remove'));
    remove.addEventListener('click', () => void removeTvSource(source.id).then(draw, (err: unknown) => toast(errorText(err, { service: 'iptv' }))));
    const guides = h('button', { class: 'button', 'aria-expanded': String(openGuides.has(source.id)), 'data-focus-id': `guides:${source.id}` }, t('livetv.guides.button'));
    const panel = openGuides.get(source.id);
    guides.addEventListener('click', () => {
      if (openGuides.has(source.id)) openGuides.get(source.id)!.remove();
      if (openGuides.has(source.id)) openGuides.delete(source.id);
      else {
        const opened = guidesPanel(source);
        openGuides.set(source.id, opened);
        item.after(opened);
      }
      guides.setAttribute('aria-expanded', String(openGuides.has(source.id)));
    });
    const guide = source.epgError
      ? t('integrations.live-tv.guide-error', { error: errorText(source.epgError) })
      : source.epgAt
        ? t('integrations.live-tv.guide-updated', { when: ago(source.epgAt) })
        : t('integrations.live-tv.guide-pending');
    const channels = tn('integrations.live-tv.channels', source.channels, { when: ago(source.channelsAt) });
    const detail = `${source.kind === 'xtream' ? 'Xtream' : 'M3U'} · ${source.host} · ${channels} · ${guide}`;
    const item = h(
      'div',
      { class: 'setting-row tv-source' },
      h(
        'div',
        { class: 'setting-text' },
        h('span', { class: 'setting-label' }, source.name, source.insecure ? h('span', { class: 'tv-insecure', title: t('integrations.live-tv.insecure-title') }, t('integrations.live-tv.insecure')) : ''),
        h('span', { class: 'setting-hint' }, detail),
        accountLine(source) ?? '',
      ),
      h('div', { class: 'tv-source-actions' }, guides, refresh, remove),
    );
    const group = h('div', { class: 'tv-source-group' }, item);
    if (source.kind === 'xtream') {
      // Named by its row's label, as the other switches in a row are, not with that label repeated beside it.
      const toggle = createSwitch('', source.useVod, (on) => {
        void setVodEnabled(source.id, on).then(draw, (err: unknown) => { toast(errorText(err, { service: 'iptv' })); void draw(); });
      });
      toggle.setAttribute('aria-label', t('livetv.vod.enable'));
      toggle.dataset.focusId = `vod:${source.id}`;
      group.append(row(t('livetv.vod.enable'), t('livetv.vod.hint'), toggle));
    }
    if (panel) group.append(panel);
    return group;
  }

  void draw();
  // A guide finishing in the background updates the row, also while Accounts is out of sight (another
  // category or page): the page is kept, so it comes back with what was true then otherwise.
  redrawLatest = () => void draw();
  if (!listening) {
    listening = true;
    void onTvUpdated(() => redrawLatest?.());
  }
  return panel;
}

/** Whether the Xtream accounts' films and episodes join a title's sources (each account has its own switch too). */
function vodSettings(): HTMLElement {
  const section = h('div', {}, h('h3', { class: 'settings-subheading' }, t('livetv.vod.heading')));
  void settings
    .get(VOD_SOURCES_KEY)
    .catch(() => null)
    .then((on) => {
      const toggle = createSwitch('', parseVodSources(on), (value) => void save(VOD_SOURCES_KEY, value));
      toggle.setAttribute('aria-label', t('livetv.vod.sources'));
      section.append(row(t('livetv.vod.sources'), t('livetv.vod.sources-hint'), toggle));
    });
  return section;
}

/** What opening Live TV shows: which group, and whether the last channel plays again. */
function openingSettings(): HTMLElement {
  const section = h('div', {}, h('h3', { class: 'settings-subheading' }, t('livetv.settings.heading')));
  void Promise.all([settings.get(LIVE_SETTINGS.openOn).catch(() => null), settings.get(LIVE_SETTINGS.resumeLast).catch(() => null)]).then(([openOn, resume]) => {
    const groups = [
      ['all', t('livetv.settings.open-all')],
      ['favourites', t('livetv.settings.open-favourites')],
      ['last', t('livetv.settings.open-last')],
    ] as const;
    const resumeSwitch = createSwitch('', resume === true, (on) => void save(LIVE_SETTINGS.resumeLast, on));
    resumeSwitch.setAttribute('aria-label', t('livetv.settings.resume'));
    section.append(
      row(t('livetv.settings.open-on'), t('livetv.settings.open-on-hint'), choices(t('livetv.settings.open-on'), groups, parseOpenOn(openOn), (v) => void save(LIVE_SETTINGS.openOn, v))),
      row(t('livetv.settings.resume'), t('livetv.settings.resume-hint'), resumeSwitch),
    );
  });
  return section;
}

/** Add an M3U playlist or an Xtream login, with an optional guide address. */
function addForm(onAdded: () => void): HTMLElement {
  let kind: 'm3u' | 'xtream' = 'm3u';
  const field = (label: string, placeholder: string, type: 'text' | 'url' | 'password' = 'text') => {
    const input = createTextField({ label, placeholder, onSubmit: () => void add() });
    input.type = type;
    return input;
  };
  const name = field(t('integrations.live-tv.name'), t('integrations.live-tv.name-placeholder'));
  const playlist = field(t('integrations.live-tv.playlist'), t('integrations.live-tv.playlist-placeholder'), 'url');
  const server = field(t('integrations.live-tv.server'), t('integrations.live-tv.server-placeholder'), 'url');
  const username = field(t('integrations.common.username'), t('integrations.common.username'));
  const password = field(t('integrations.common.password'), t('integrations.common.password'), 'password');
  const epg = field(t('integrations.live-tv.epg'), t('integrations.live-tv.epg-placeholder'), 'url');
  const message = h('p', { class: 'provider-message', role: 'status' });
  const button = h('button', { class: 'button primary' }, t('integrations.live-tv.add'));
  button.addEventListener('click', () => void add());
  // Shown while the source is checked: a slow provider can keep that going for minutes.
  const cancel = h('button', { class: 'button', hidden: true }, t('integrations.common.cancel'));
  const check = createSourceCheck<TvSource>({
    checking: () => {
      button.disabled = true;
      cancel.hidden = false;
      message.textContent = t('integrations.live-tv.checking');
    },
    done: (added) => {
      message.textContent = tn('integrations.live-tv.added', added.channels, { name: added.name });
      for (const input of [name, playlist, server, username, password, epg]) input.value = '';
      onAdded();
    },
    // The general line for a refused login says to remove the source and add it again: not yet added here.
    failed: (err) => {
      message.textContent = classify(err, 'iptv').cause === 'signed-out' ? t('integrations.live-tv.add-refused') : errorText(err, { service: 'iptv' });
    },
    idle: () => {
      const focused = document.activeElement === cancel;
      cancel.hidden = true;
      button.disabled = false;
      if (focused) button.focus();
    },
  });
  cancel.addEventListener('click', () => {
    check.cancel();
    message.textContent = '';
  });

  const m3uFields = h('div', { class: 'tv-fields' }, playlist);
  const xtreamFields = h('div', { class: 'tv-fields', hidden: true }, server, username, password);
  const kinds = choices(t('integrations.live-tv.kind-label'), [['m3u', t('integrations.live-tv.kind-m3u')], ['xtream', t('integrations.live-tv.kind-xtream')]] as const, kind, (value) => {
    kind = value;
    m3uFields.hidden = value !== 'm3u';
    xtreamFields.hidden = value !== 'xtream';
  });

  async function add(): Promise<void> {
    const guide = epg.value.trim() || undefined;
    const source: NewTvSource =
      kind === 'm3u'
        ? { kind, name: name.value, playlist: playlist.value, ...(guide ? { epg: guide } : {}) }
        : { kind, name: name.value, server: server.value, username: username.value, password: password.value, ...(guide ? { epg: guide } : {}) };
    if (check.pending) return;
    await check.start(addTvSource(source));
  }

  return h(
    'div',
    { class: 'tv-add' },
    h('h3', { class: 'settings-subheading' }, t('integrations.live-tv.add-heading')),
    row(t('integrations.live-tv.kind'), t('integrations.live-tv.kind-hint'), kinds),
    h('div', { class: 'tv-fields' }, name),
    m3uFields,
    xtreamFields,
    h('div', { class: 'tv-fields' }, epg),
    h('p', { class: 'setting-hint' }, t('integrations.live-tv.fields-hint')),
    h('div', { class: 'hero-actions' }, button, cancel),
    message,
  );
}
