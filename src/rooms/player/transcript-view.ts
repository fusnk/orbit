/** Persistent transcript view: playback ticks update rows without replacing the search field or focus. */
import { invoke } from '@tauri-apps/api/core';
import { createSwitch } from '../../components/switch';
import { toast } from '../../components/toast';
import { profileSetting } from '../../library/profiles';
import { createTextField } from '../../components/text-field';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { cueSeekTime, currentCues, matchSlices, nextMatch, shouldFollow, transcriptEscape, transcriptIndices, TRANSCRIPT_PAGE_SIZE, TRANSCRIPT_WHOLE_KEY, type TranscriptData } from './transcript';
import './transcript.css';

const stamp = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return value >= 3600 ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

export function createTranscript(host: { seek(seconds: number): void; close(): void; changed(): void }) {
  let data: TranscriptData = { trackId: null, available: false, cues: [] };
  let track: number | null = null;
  let generation = 0;
  let loading = false;
  let failed = false;
  let time = 0;
  let delay = 0;
  let whole = false;
  let preferenceKey: string | undefined;
  let restoringFocus = false;
  let query = '';
  let selected = -1;
  let page = 0;
  let lastInteraction = -Infinity;
  let rowSignature = '';
  let disposed = false;
  const search = createTextField({ label: t('player.transcript.search'), placeholder: t('player.transcript.search'), onSubmit: () => pickMatch(1) });
  search.dataset.focusId = 'transcript-search';
  const count = h('span', { class: 'panel-note', role: 'status' });
  const note = h('p', { class: 'panel-note' });
  const list = h('div', { class: 'transcript-list' });
  const button = (key: 'previous' | 'next' | 'earlier' | 'later' | 'resume-scroll', action: () => void) => {
    const element = h('button', { class: 'chip', 'data-focus-id': `transcript-${key}` }, t(`player.transcript.${key}`));
    element.addEventListener('click', action);
    return element;
  };
  const previous = button('previous', () => pickMatch(-1));
  const next = button('next', () => pickMatch(1));
  const earlier = button('earlier', () => turnPage(-1));
  const later = button('later', () => turnPage(1));
  const follow = button('resume-scroll', () => { lastInteraction = -Infinity; update(); });
  const toggle = createSwitch(t('player.transcript.whole'), false, () => {
    if (!preferenceKey) return;
    const previousWhole = whole;
    whole = !whole;
    toggle.setAttribute('aria-checked', String(whole));
    page = 0;
    rowSignature = '';
    update();
    toggle.disabled = true;
    void settings.set(preferenceKey, whole).catch(() => {
      if (disposed) return;
      whole = previousWhole;
      toggle.setAttribute('aria-checked', String(whole));
      rowSignature = '';
      update();
      toast(t('settings.common.save-failed'));
    }).finally(() => { if (!disposed) toggle.disabled = false; });
  });
  toggle.dataset.focusId = 'transcript-whole';
  toggle.disabled = true;
  const element = h('div', { class: 'transcript' }, search, h('div', { class: 'transcript-tools' }, count, previous, next), toggle, note, list, h('div', { class: 'transcript-pages' }, earlier, later, follow));
  search.addEventListener('input', () => { query = search.value; selected = -1; page = 0; rowSignature = ''; update(); });
  // Capture Escape before text-field's editing handler and the player's fixed Back handler.
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      escape();
    } else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Tab'].includes(event.key)) lastInteraction = performance.now();
  }, true);
  const interacted = () => { lastInteraction = performance.now(); };
  element.addEventListener('wheel', interacted, { passive: true });
  element.addEventListener('touchmove', interacted, { passive: true });
  // Also catches dragging the panel scrollbar; programmatic scroll events never suspend following.
  element.addEventListener('pointerdown', interacted);
  element.addEventListener('focusin', (event) => { if (!restoringFocus && event.target instanceof Node && list.contains(event.target)) interacted(); });
  void profileSetting(TRANSCRIPT_WHOLE_KEY).then(({ key, value }) => {
    if (disposed) return;
    preferenceKey = key;
    toggle.disabled = false;
    whole = value === true;
    toggle.setAttribute('aria-checked', String(whole));
    update();
  }).catch(() => { if (!disposed) toast(t('settings.common.save-failed')); });

  function escape(): void {
    if (transcriptEscape(query) === 'clear') {
      query = '';
      search.value = '';
      rowSignature = '';
      page = 0;
      update();
    } else host.close();
  }

  function visible(): number[] { return transcriptIndices(data.cues, time, delay, whole, query); }
  function turnPage(direction: 1 | -1): void {
    lastInteraction = performance.now();
    page = Math.max(0, page + direction);
    rowSignature = '';
    update();
  }
  function pickMatch(direction: 1 | -1): void {
    const index = nextMatch(visible(), selected, direction);
    if (index === undefined) return;
    selected = index;
    lastInteraction = performance.now();
    const indices = visible();
    page = Math.floor(indices.indexOf(index) / TRANSCRIPT_PAGE_SIZE);
    rowSignature = '';
    update();
    list.querySelector<HTMLElement>(`[data-cue="${index}"]`)?.focus({ preventScroll: false });
  }
  function update(): void {
    const indices = visible();
    const current = currentCues(data.cues, time, delay);
    const following = shouldFollow(performance.now(), lastInteraction) && !query.trim();
    const target = current.at(-1);
    if (following && target !== undefined && indices.includes(target)) page = Math.floor(indices.indexOf(target) / TRANSCRIPT_PAGE_SIZE);
    page = Math.min(page, Math.max(0, Math.ceil(indices.length / TRANSCRIPT_PAGE_SIZE) - 1));
    const shown = indices.slice(page * TRANSCRIPT_PAGE_SIZE, (page + 1) * TRANSCRIPT_PAGE_SIZE);
    count.textContent = query.trim() ? tn('player.transcript.matches', indices.length) : '';
    previous.disabled = next.disabled = !query.trim() || !indices.length;
    earlier.disabled = page === 0;
    later.disabled = (page + 1) * TRANSCRIPT_PAGE_SIZE >= indices.length;
    follow.hidden = following;
    note.textContent = loading ? t('player.transcript.loading') : failed ? t('player.transcript.failed') : !data.available ? t('player.transcript.unavailable') : !indices.length ? t(query.trim() ? 'player.transcript.no-matches' : 'player.transcript.empty') : !whole ? t('player.transcript.hidden') : t('player.transcript.hint');
    const signature = `${generation}|${query}|${delay}|${shown.join(',')}`;
    if (signature !== rowSignature) {
      rowSignature = signature;
      const focus = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.cue : undefined;
      list.replaceChildren(...shown.map((index) => {
        const cue = data.cues[index]!;
        const line = h('span', { class: 'transcript-text', dir: 'auto' }, ...matchSlices(cue.text, query).map((part) => part.match ? h('mark', {}, part.text) : document.createTextNode(part.text)));
        const row = h('button', { class: 'transcript-row', 'data-cue': String(index), 'data-focus-id': `transcript-cue-${index}` }, h('time', { dir: 'ltr' }, stamp(cueSeekTime(cue, delay))), line);
        row.addEventListener('click', () => { selected = index; host.seek(cueSeekTime(cue, delay)); });
        return row;
      }));
      if (focus) {
        restoringFocus = true;
        (list.querySelector<HTMLElement>(`[data-cue="${focus}"]`) ?? search).focus({ preventScroll: true });
        restoringFocus = false;
      }
    }
    for (const row of list.querySelectorAll<HTMLElement>('[data-cue]')) {
      const active = current.includes(Number(row.dataset.cue));
      row.classList.toggle('current', active);
      row.setAttribute('aria-current', String(active));
    }
    if (following && target !== undefined && element.isConnected) {
      const row = list.querySelector<HTMLElement>(`[data-cue="${target}"]`);
      const scroller = element.closest<HTMLElement>('.player-panel-body');
      if (row && scroller) {
        const r = row.getBoundingClientRect();
        const bounds = scroller.getBoundingClientRect();
        if (r.bottom > bounds.bottom || r.top < bounds.top) scroller.scrollTop += r.top - bounds.top - bounds.height / 2;
      }
    }
  }
  async function load(nextTrack: number | null, force = false): Promise<void> {
    if (!force && nextTrack === track) return;
    track = nextTrack;
    const ticket = ++generation;
    data = { trackId: nextTrack, available: false, cues: [] };
    loading = nextTrack !== null;
    failed = false;
    page = 0;
    selected = -1;
    rowSignature = '';
    update();
    if (nextTrack === null) return;
    try {
      const result = await invoke<TranscriptData>('player_transcript');
      if (disposed || ticket !== generation || result.trackId !== track) return;
      data = result;
    } catch { if (ticket === generation) failed = true; }
    finally {
      if (!disposed && ticket === generation) { loading = false; update(); host.changed(); }
    }
  }
  return {
    element,
    escape,
    interacted,
    load,
    tick(position: number | null, subtitleDelay: number): void { time = position ?? 0; delay = subtitleDelay; update(); },
    reset(): void { ++generation; track = null; data = { trackId: null, available: false, cues: [] }; loading = false; query = ''; search.value = ''; rowSignature = ''; update(); },
    dispose(): void { disposed = true; ++generation; },
  };
}
