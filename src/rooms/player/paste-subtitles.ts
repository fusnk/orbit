/**
 * Player → Subtitles → Paste subtitles…: a drawer with a box for the text
 * of an SRT or WebVTT file. Rust checks and rebuilds it (paste.rs) and adds
 * it to mpv in memory; nothing is written to disk. The box keeps focus and
 * editing apart like other fields: it opens ready to type (choosing Paste
 * asked for that), Escape stops typing, and Enter or a click starts again.
 */
import { invoke } from '@tauri-apps/api/core';
import { openDrawer } from '../../components/drawer';
import { toast } from '../../components/toast';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import './paste-subtitles.css';

/** Matches MAX_PASTE_BYTES in src-tauri/src/player/paste.rs. */
export const MAX_PASTE_BYTES = 2 * 1024 * 1024;

const ERRORS: Record<string, MessageKey> = {
  empty: 'playertools.paste.empty',
  'too-big': 'playertools.paste.too-big',
  'not-subtitles': 'playertools.paste.bad',
};

/** What's wrong with `text` before sending it, if anything ('' when it's worth a try). */
export function pasteProblem(text: string): MessageKey | '' {
  if (!text.trim()) return 'playertools.paste.empty';
  if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES) return 'playertools.paste.too-big';
  return '';
}

/**
 * Opens the drawer; `closed` runs when it goes (the panel puts focus back, as its rows may have been redrawn meanwhile).
 * `added` runs once the subtitles are in, and gives a note to add to the toast ('' for none).
 */
export function openPasteSubtitles(closed?: () => void, added?: () => string): void {
  const area = h('textarea', { class: 'paste-subtitles-field', rows: '12', 'aria-label': t('playertools.paste.field'), placeholder: t('playertools.paste.placeholder'), spellcheck: 'false', readonly: true, 'data-nav-arrows': true, 'data-autofocus': true });
  const status = h('p', { class: 'paste-subtitles-status', role: 'status' });
  const add = h('button', { class: 'button primary' }, t('playertools.paste.add'));
  const cancel = h('button', { class: 'button' }, t('playertools.paste.cancel'));

  const editing = (on: boolean) => {
    area.readOnly = !on;
    area.toggleAttribute('data-nav-arrows', !on);
    area.classList.toggle('editing', on);
  };
  area.addEventListener('pointerdown', () => editing(true));
  area.addEventListener('blur', () => editing(false));
  area.addEventListener('input', () => (status.textContent = ''));
  area.addEventListener('keydown', (event) => {
    if (area.readOnly) {
      if (event.key === 'Enter') {
        event.preventDefault();
        editing(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      // Stops typing; a second Escape closes the drawer.
      event.preventDefault();
      event.stopPropagation();
      editing(false);
    }
  });

  let sending = false;
  add.addEventListener('click', () => {
    if (sending) return;
    const problem = pasteProblem(area.value);
    if (problem) {
      status.textContent = t(problem);
      return;
    }
    sending = true;
    add.disabled = true;
    invoke('player_paste_subtitle', { text: area.value, name: t('playertools.paste.name') })
      .then(() => {
        close();
        const note = added?.() ?? '';
        toast(note ? `${t('playertools.paste.added')} · ${note}` : t('playertools.paste.added'));
      })
      .catch((err: unknown) => {
        const key = typeof err === 'string' ? ERRORS[err] : undefined;
        if (!key) console.error('Could not add pasted subtitles', err);
        status.textContent = t(key ?? 'player.tracks.bad-file');
      })
      .finally(() => {
        sending = false;
        add.disabled = false;
      });
  });
  cancel.addEventListener('click', () => close());

  const content = h(
    'div',
    { class: 'paste-subtitles' },
    h('h2', { class: 'paste-subtitles-title' }, t('playertools.paste.title')),
    h('p', { class: 'muted' }, t('playertools.paste.hint')),
    area,
    status,
    h('div', { class: 'paste-subtitles-actions' }, cancel, add),
  );
  const close = openDrawer(content, t('playertools.paste.title'), closed);
  editing(true);
}
