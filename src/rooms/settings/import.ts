/**
 * Settings → Library → Import: a Letterboxd or Trakt data export (.zip).
 * Rust reads it and matches the titles (see src-tauri/src/import.rs), the
 * page shows what it found, and nothing is saved until the person confirms.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { loadLibrary } from '../../library/library';
import { loadWatch } from '../../library/watch';
import { row } from './playback';
import { errorText } from '../../components/state-message';

interface Summary {
  source: 'letterboxd' | 'trakt';
  movies: number;
  shows: number;
  episodes: number;
  watchlist: number;
  unmatched: number;
  unmatchedNames: string[];
}

const SOURCE_NAMES = { letterboxd: 'Letterboxd', trakt: 'Trakt' } as const;
/** The largest export Rust reads (src-tauri/src/import.rs `MAX_ZIP`). */
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export function importSection(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  const choose = h('button', { class: 'button' }, t('integrations.import.choose'));
  const status = h('div', { class: 'import-status', role: 'status' });
  // A flag rather than `disabled` while a file is read: disabling the focused button would drop focus to the page.
  let busy = false;
  choose.addEventListener('click', () => !busy && input.click());

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void read(file);
  });

  async function read(file: File): Promise<void> {
    // Rust refuses these anyway (import.rs MAX_ZIP); checked first so a huge file isn't read into memory to get there.
    if (file.size > MAX_IMPORT_BYTES) return void status.replaceChildren(h('p', { class: 'provider-message' }, t('errors.import.too-large')));
    busy = true;
    choose.setAttribute('aria-busy', 'true');
    status.replaceChildren(h('p', { class: 'muted' }, t('integrations.import.reading')));
    const stop = await listen<[number, number]>('import://progress', ({ payload: [done, total] }) => {
      status.replaceChildren(h('p', { class: 'muted' }, t('integrations.import.progress', { done, total })));
    });
    try {
      // Sent as raw bytes, not JSON. The time zone puts Letterboxd's dates (days, no time) on the right day.
      const summary = await invoke<Summary>('import_read', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-utc-offset': String(new Date().getTimezoneOffset()) } });
      showSummary(summary);
    } catch (err) {
      status.replaceChildren(h('p', { class: 'provider-message' }, errorText(err)));
    } finally {
      stop();
      busy = false;
      choose.removeAttribute('aria-busy');
    }
  }

  function showSummary(s: Summary): void {
    const found = [
      s.movies ? tn('integrations.import.films', s.movies) : '',
      s.shows ? t('integrations.import.episodes-of-shows', { episodes: tn('integrations.import.episodes', s.episodes), shows: tn('integrations.import.shows', s.shows) }) : '',
      s.watchlist ? tn('integrations.import.watchlist', s.watchlist) : '',
    ].filter(Boolean);
    if (!found.length) {
      status.replaceChildren(h('p', { class: 'provider-message' }, t('integrations.import.nothing', { source: SOURCE_NAMES[s.source] })));
      return;
    }
    const apply = h('button', { class: 'button primary' }, t('integrations.import.import'));
    const cancel = h('button', { class: 'button' }, t('integrations.common.cancel'));
    const actions = h('div', { class: 'import-actions' }, apply, cancel);
    cancel.addEventListener('click', () => {
      if (applying) return;
      void invoke('import_cancel').catch(() => {});
      status.replaceChildren();
      choose.focus();
    });
    let applying = false;
    /** The summary's buttons are replaced by the outcome: focus goes back to Choose rather than the page. */
    const settle = (...message: HTMLElement[]) => {
      const hadFocus = status.contains(document.activeElement);
      status.replaceChildren(...message);
      if (hadFocus) choose.focus();
    };
    apply.addEventListener('click', () => {
      if (applying) return;
      applying = true;
      actions.setAttribute('aria-busy', 'true');
      void invoke('import_apply')
        .then(() => Promise.all([loadWatch(), loadLibrary()]))
        .then(() => {
          settle(h('p', { class: 'provider-message' }, t('integrations.import.done', { source: SOURCE_NAMES[s.source] })));
          toast(t('integrations.import.done-toast', { source: SOURCE_NAMES[s.source] }));
        })
        .catch((err: unknown) => {
          settle(h('p', { class: 'provider-message' }, t('integrations.import.failed', { error: errorText(err) })));
        });
    });
    status.replaceChildren(
      h('p', {}, t('integrations.import.summary', { source: SOURCE_NAMES[s.source], found: found.join(', ') })),
      s.unmatched
        ? h('p', { class: 'muted' }, tn('integrations.import.unmatched', s.unmatched, { names: `${s.unmatchedNames.join(', ')}${s.unmatched > s.unmatchedNames.length ? '…' : ''}` }))
        : '',
      h('p', { class: 'muted' }, t('integrations.import.kept')),
      actions,
    );
    apply.focus();
  }

  return h(
    'div',
    { class: 'import-section' },
    h('h3', { class: 'settings-subheading' }, t('integrations.import.heading')),
    row(
      t('integrations.import.from'),
      t('integrations.import.from-hint'),
      choose,
    ),
    status,
    input,
  );
}
