/**
 * Theme Studio: a panel docked at the window's end side that stays open while
 * the person moves around Orbit, so every change shows on real pages as it's
 * made (theme/engine.ts previews it without saving). Opened from Settings →
 * Appearance and the command palette, maybe at a place in it: Settings'
 * links to the colours, the seek bar and the menu's pages open it there.
 *
 * Header: the theme's name, undo and redo, close. Tabs: Look, Layout, Code.
 * Footer: Export (a theme file in Downloads) and Save theme. Closing with
 * unsaved changes asks first, and throwing them away puts the saved look
 * back.
 *
 * The panel sits outside #app (which narrows to make room), so it isn't
 * covered by the page; while a menu or drawer holds the app inert, the
 * panel is made inert with it.
 */
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { SHOWN_VIEW } from '../../lib/shown';
import { undoRedo } from '../../lib/keymap';
import { isEditing } from '../../app/spatial';
import { currentLook, currentThemeId, holdSeekImages, loadTheme, previewLook, releaseSeekImages, saveLook, saveThemeFile, showSavedLook, type Look } from '../../theme/engine';
import { createHistory, type History } from '../../theme/history';
import { codeTab } from './code-tab';
import { redrawKeepingFocus } from './controls';
import { layoutTab } from './layout-tab';
import { lookTab, type Change } from './look-tab';
import './studio.css';
import { errorText } from '../../components/state-message';

type Tab = 'look' | 'layout' | 'code';
const TABS: [Tab, 'studio.tab.look' | 'studio.tab.layout' | 'studio.tab.code'][] = [
  ['look', 'studio.tab.look'],
  ['layout', 'studio.tab.layout'],
  ['code', 'studio.tab.code'],
];
/** Undo steps kept. */
const HISTORY_LIMIT = 100;

/** Where Theme Studio can be opened: a tab, or a part of one (marked `data-studio-section` there). */
export type StudioPlace = 'look' | 'colours' | 'seekbar' | 'layout' | 'code';
const PLACES: Record<StudioPlace, { tab: Tab; section?: string }> = {
  look: { tab: 'look' },
  colours: { tab: 'look', section: 'colours' },
  seekbar: { tab: 'look', section: 'seekbar' },
  layout: { tab: 'layout' },
  code: { tab: 'code' },
};

type Studio = { focus(): void; close(): void; show(place: StudioPlace): void; unsaved(): boolean; leave(): Promise<boolean>; takeSeekColor(color: string | null): void };
let open: Studio | null = null;
/** The control on the page that last opened the Studio (e.g. a Settings link): focus goes back to it on close. */
let opener: HTMLElement | null = null;

export const themeStudioOpen = () => open !== null;
/** Whether Theme Studio is open with changes not saved. */
export const themeStudioUnsaved = () => open?.unsaved() ?? false;

/**
 * Before something that would drop the Studio's edits (a reload): asks "Leave without saving?"
 * when there are any, and resolves once answered: true once the Studio has closed (saved or
 * thrown away), false to keep editing. True at once when nothing is unsaved.
 */
export const leaveThemeStudio = (): Promise<boolean> => open?.leave() ?? Promise.resolve(true);

/** A seek bar colour just saved from Settings: an open Studio takes it into what it's editing (an undo step), so Save doesn't put the old one back. */
export const seekColorSaved = (color: string | null): void => open?.takeSeekColor(color);

/**
 * Opens Theme Studio (on Look), or brings focus to it when it's already open;
 * at `place`, it goes there either way.
 */
export function openThemeStudio(place?: StudioPlace): void {
  const from = document.activeElement;
  if (from instanceof HTMLElement && from !== document.body && !from.closest('.studio')) opener = from;
  if (open && !place) return open.focus();
  open ??= createStudio();
  if (place) open.show(place);
}

const message = (err: unknown) => errorText(err);
const same = (a: Look, b: Look) => JSON.stringify(a) === JSON.stringify(b);

function createStudio(): Studio {
  let saved = currentLook();
  // Undo can go back to it: its seek-bar pictures stay while the Studio is open.
  holdSeekImages(saved);
  /** The theme being edited: Save goes into it even if another is chosen in Settings meanwhile. */
  let themeId = currentThemeId();
  let draft = saved;
  const history: History<Look> = createHistory(saved, HISTORY_LIMIT);
  let tab: Tab = 'look';
  let confirming = false;
  let busy = false;
  /** Waiting for the answer to `leave()`'s prompt. */
  let answer: ((left: boolean) => void) | null = null;
  const answered = (left: boolean) => {
    answer?.(left);
    answer = null;
  };

  const title = h('span', { class: 'studio-name' });
  const roundButton = (glyph: 'undo' | 'redo' | 'close', label: string, run: () => void) => {
    const button = h('button', { class: 'round-button', 'aria-label': label, title: label, 'data-studio-key': `head:${glyph}` }, icon(glyph));
    button.addEventListener('click', run);
    return button;
  };
  /** The Code tab's CSS edit still waiting for typing to stop; applied before anything reads the draft. */
  let flushCode: (() => void) | null = null;
  const flush = () => flushCode?.();
  const undo = roundButton('undo', t('studio.undo'), () => {
    flush();
    step(history.undo());
  });
  const redo = roundButton('redo', t('studio.redo'), () => {
    flush();
    step(history.redo());
  });
  const close = roundButton('close', t('studio.close'), () => requestClose());

  function showTab(id: Tab): void {
    flush();
    tab = id;
    drawTabs();
    redrawKeepingFocus(body, drawBody);
    body.scrollTop = 0;
  }

  const tabButtons = TABS.map(([id, label]) => {
    const button = h('button', { class: 'segment studio-tab-button', role: 'tab', id: `studio-tab-${id}`, 'aria-controls': 'studio-tabpanel', 'data-studio-key': `tab:${id}` }, t(label));
    button.addEventListener('click', () => showTab(id));
    return button;
  });
  const tabs = h('div', { class: 'segments studio-tabs', role: 'tablist', 'aria-label': t('studio.tabs-label') }, ...tabButtons);
  const body = h('div', { class: 'studio-body', id: 'studio-tabpanel', role: 'tabpanel' });
  const footer = h('footer', { class: 'studio-footer' });
  // "Leave without saving?": a screen over the whole panel, so it can't be missed.
  const confirmLayer = h('div', { class: 'studio-confirm-layer', hidden: true });

  const panel = h(
    'aside',
    // Arrow keys stay in the panel while there's somewhere to go in it.
    { class: 'studio', 'aria-label': t('studio.title'), 'data-nav-region': true },
    h(
      'header',
      { class: 'studio-header' },
      h('div', { class: 'studio-heading' }, h('span', { class: 'eyebrow' }, t('studio.title')), title),
      h('div', { class: 'studio-header-actions' }, undo, redo, close),
    ),
    tabs,
    body,
    footer,
    confirmLayer,
  );

  const change: Change = (look, options = {}) => {
    draft = look;
    history.push(look, options.group);
    previewLook(draft);
    if (options.redraw !== false) redraw();
    else drawChrome();
  };

  function step(look: Look): void {
    draft = look;
    previewLook(draft);
    redraw();
  }

  function drawTabs(): void {
    for (const [i, [id]] of TABS.entries()) {
      tabButtons[i]!.setAttribute('aria-selected', String(id === tab));
    }
    body.setAttribute('aria-labelledby', `studio-tab-${tab}`);
  }

  function drawBody(): void {
    const top = body.scrollTop;
    const code = tab === 'code' ? codeTab(draft, change) : null;
    flushCode = code?.flush ?? null;
    body.replaceChildren(code?.element ?? (tab === 'look' ? lookTab(draft, change) : layoutTab(draft, change)));
    body.scrollTop = top;
  }

  function drawChrome(): void {
    title.textContent = draft.name.trim() || t('studio.name-placeholder');
    const focused = document.activeElement;
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
    // Disabled, the button just pressed (undo at the first step, redo at the last) lets go of the focus: the other takes it.
    if (focused === undo && undo.disabled) redo.focus({ preventScroll: true });
    else if (focused === redo && redo.disabled) undo.focus({ preventScroll: true });
    const dirty = !same(draft, saved);
    panel.dataset.dirty = String(dirty);
    drawConfirm();
    redrawKeepingFocus(footer, () => {
      const exportButton = h('button', { class: 'button', 'data-studio-key': 'foot:export' }, icon('download'), t('studio.export'));
      exportButton.addEventListener('click', () => {
        const { name, tagline, colors, fonts, appearance, layout, seekbar, css, style } = draft;
        saveThemeFile({ name: name.trim() || t('studio.name-placeholder'), ...(tagline.trim() ? { tagline } : {}), colors, fonts, appearance, layout, seekbar, css, ...(style ? { style } : {}) })
          .then((path) => path && toast(t('settings.common.saved-to', { path })))
          .catch((err: unknown) => toast(message(err)));
      });
      // Not `disabled` while saving: a disabled button drops the keyboard focus. A press meanwhile does nothing.
      const save = h('button', { class: 'button primary', 'aria-disabled': busy && 'true', 'data-studio-key': 'foot:save' }, t('studio.save'));
      save.addEventListener('click', () => !busy && void saveDraft());
      footer.replaceChildren(h('span', { class: 'studio-status', 'aria-live': 'polite' }, dirty ? t('studio.unsaved') : ''), h('div', { class: 'studio-footer-actions' }, exportButton, save));
    });
  }

  function drawConfirm(): void {
    confirmLayer.hidden = !confirming;
    // The rest of the panel is out of reach while it asks. While a save runs, nothing can be edited either: the
    // draft becomes what was saved once it's done, which would drop an edit made meanwhile without a word.
    for (const part of [tabs, body, undo, redo]) part.inert = confirming || busy;
    for (const part of [footer, close]) part.inert = confirming;
    if (!confirming) return confirmLayer.replaceChildren();
    if (confirmLayer.childElementCount) return;
    const keep = h('button', { class: 'button primary', 'data-studio-key': 'confirm:keep' }, t('studio.keep-editing'));
    keep.addEventListener('click', () => {
      confirming = false;
      drawChrome();
      close.focus();
      answered(false);
    });
    const saveClose = h('button', { class: 'button', 'data-studio-key': 'confirm:save' }, t('studio.save-close'));
    saveClose.addEventListener('click', () => {
      confirming = false;
      // A save that failed (it says why) leaves the Studio open.
      void saveDraft().then(() => (same(draft, saved) ? finish() : answered(false)));
    });
    const discard = h('button', { class: 'button danger', 'data-studio-key': 'confirm:discard' }, t('studio.discard-all'));
    discard.addEventListener('click', () => {
      showSavedLook(saved.css);
      // Another theme was chosen (or this one deleted) while editing: what's saved now is
      // that theme, not the snapshot taken on opening, so it's applied from the settings.
      if (currentThemeId() !== themeId) void loadTheme();
      finish();
    });
    confirmLayer.append(
      h(
        'div',
        { class: 'studio-confirm-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'studio-confirm-title', 'aria-describedby': 'studio-confirm-text' },
        h('h3', { class: 'studio-confirm-title', id: 'studio-confirm-title' }, t('studio.leave-title')),
        h('p', { class: 'studio-confirm-text', id: 'studio-confirm-text' }, t('studio.leave-text')),
        h('div', { class: 'studio-confirm-actions' }, keep, saveClose, discard),
      ),
    );
  }

  function redraw(): void {
    drawChrome();
    redrawKeepingFocus(body, drawBody);
  }

  async function saveDraft(): Promise<void> {
    flush();
    busy = true;
    drawChrome();
    try {
      const theme = await saveLook(draft, themeId);
      themeId = theme.id;
      saved = currentLook();
      draft = saved;
      history.reset(saved);
      toast(t('studio.saved', { name: theme.name }));
    } catch (err) {
      toast(message(err));
    } finally {
      busy = false;
      redraw();
    }
  }

  function requestClose(): void {
    flush();
    if (same(draft, saved)) return finish();
    confirming = true;
    drawChrome();
    confirmLayer.querySelector<HTMLElement>('[data-studio-key="confirm:keep"]')?.focus();
  }

  // The panel's own keys: Escape closes (unless a field took it), Ctrl+Z / Ctrl+Y undo and redo.
  panel.addEventListener('keydown', (event) => {
    // Fields being typed in keep their keys; a slider or the CSS editor that's only focused (data-nav-arrows) doesn't.
    if (event.defaultPrevented || (isEditing(event.target) && !(event.target as HTMLElement).hasAttribute('data-nav-arrows'))) return;
    const edit = undoRedo(event);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (confirming) {
        confirming = false;
        drawChrome();
        close.focus();
        answered(false);
      } else requestClose();
    } else if (edit) {
      event.preventDefault();
      if (busy) return;
      const redoing = edit === 'redo';
      flush();
      if (redoing ? history.canRedo : history.canUndo) step(redoing ? history.redo() : history.undo());
    }
  });

  // Inert with the app while a menu or drawer is open over it.
  const app = document.getElementById('app');
  const inert = new MutationObserver(() => (panel.inert = !!app?.inert));
  if (app) inert.observe(app, { attributes: true, attributeFilter: ['inert'] });

  function finish(): void {
    inert.disconnect();
    releaseSeekImages();
    panel.remove();
    delete document.documentElement.dataset.studio;
    open = null;
    answered(true);
    // Back to what opened it (a Settings link), else to the page, where focus would otherwise be lost.
    const back = opener?.isConnected && opener.offsetParent ? opener : document.querySelector<HTMLElement>(`.outlet > .${SHOWN_VIEW} [data-autofocus], .nav-item[tabindex="0"]`);
    opener = null;
    back?.focus({ preventScroll: true });
  }

  drawTabs();
  redraw();
  document.body.append(panel);
  document.documentElement.dataset.studio = 'open';
  tabButtons[0]!.focus({ preventScroll: true });

  const focusTab = () => tabButtons.find((b) => b.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });

  /** Goes to `place`: its tab, scrolled to its part with focus on that part's first control. */
  function show(place: StudioPlace): void {
    // "Leave without saving?" is up: it keeps the focus until answered.
    if (confirming) return;
    const { tab: wanted, section } = PLACES[place];
    if (wanted !== tab) showTab(wanted);
    const part = section ? body.querySelector<HTMLElement>(`[data-studio-section="${section}"]`) : null;
    if (!part) return focusTab();
    part.scrollIntoView({ block: 'start' });
    (part.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? tabButtons[0])!.focus({ preventScroll: true });
  }

  function leave(): Promise<boolean> {
    flush();
    if (same(draft, saved)) {
      finish();
      return Promise.resolve(true);
    }
    // Asked again while asking: the earlier wait counts as kept editing.
    answered(false);
    // The caller just closed what held the app inert; the observer would only catch up after this.
    panel.inert = !!app?.inert;
    return new Promise((resolve) => {
      answer = resolve;
      requestClose();
    });
  }

  function unsaved(): boolean {
    flush();
    return !same(draft, saved);
  }

  function takeSeekColor(color: string | null): void {
    flush();
    const withColor = (look: Look): Look => ({ ...look, seekbar: { ...look.seekbar, color } });
    // Already saved, so it doesn't count as unsaved on its own.
    saved = withColor(saved);
    change(withColor(draft));
  }

  return { focus: focusTab, close: requestClose, show, unsaved, leave, takeSeekColor };
}
