/**
 * Settings → Appearance → Colours: theme presets as cards drawn in their own
 * colours, the person's own themes (save, import, export as a file, delete),
 * the accent, the player's seek bar colour, the tint and the font pair.
 * Each colour is edited in Theme Studio (one editor, with hex fields,
 * readability warnings and undo); the Theme row links there.
 */
import { toast } from '../../components/toast';
import { beginEditing, createTextField } from '../../components/text-field';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { appearance, setAppearance } from '../../theme/appearance';
import { applyFonts } from '../../theme/fonts';
import { currentNavLayout } from '../../theme/layout';
import { chooseTheme, currentFonts, currentThemeId, deleteTheme, exportTheme, importTheme, myThemes, saveCurrentAs, setFonts } from '../../theme/engine';
import { COLOR_KEYS, parseThemeFile, PRESETS, THEME_FILE_MAX_BYTES, type Colors, type Preset, type ThemeStyle } from '../../theme/palette';
import { createAccentPanel } from './accent';
import { playerColourRow } from './player-colour';
import { createSwitch } from '../../components/switch';
import { FONTS, fontOptions, inOwnTypefaces, TINT } from '../studio/look-choices';
import { choices, row } from './playback';
import { studioLink } from './studio-link';
import { errorText } from '../../components/state-message';

const message = (err: unknown) => errorText(err);

/** A small picture of a page in the theme's colours: panel, posters, text and the accent. */
function miniature(c: Colors, style?: ThemeStyle): HTMLElement {
  const box = h(
    'span',
    { class: 'theme-mini', 'aria-hidden': 'true', ...(style ? { 'data-mini-style': style } : {}) },
    h('span', { class: 'theme-mini-bar' }),
    h('span', { class: 'theme-mini-line' }),
    h('span', { class: 'theme-mini-line short' }),
    h('span', { class: 'theme-mini-posters' }, h('span', {}), h('span', {}), h('span', {})),
    h('span', { class: 'theme-mini-button' }),
  );
  for (const key of COLOR_KEYS) box.style.setProperty(`--mini-${key}`, c[key]);
  return box;
}

/** What had focus in the section when a theme change drew the whole page again, for the section drawn next to give back. */
let refocus: string | null = null;

const focusKey = (el: HTMLElement): string | null => el.getAttribute('aria-label') ?? el.textContent;

/**
 * `onPageChanged` draws the whole page again: one of the person's own themes can bring its Type & finish and its
 * menu (engine.ts chooseTheme), which rows elsewhere on the page show, and that page doesn't redraw for a change
 * made on it.
 */
export function coloursSection(onPageChanged?: () => void): HTMLElement {
  const section = h('div', { class: 'themes' });
  let naming = false;
  /** Where focus goes when the button that had it is gone after the next draw (Cancel, Save, Delete). */
  let focusAfter: (() => HTMLElement | null | undefined) | null = null;
  const saveAsButton = () => section.querySelector<HTMLElement>('.my-themes .wallpaper-control button');

  const failed = (err: unknown) => toast(message(err));
  /** The settings a theme can bring that rows outside this section show. */
  const outside = () => JSON.stringify([appearance(), currentNavLayout()]);
  const then = (work: Promise<unknown>) => {
    const before = outside();
    const done = () => {
      // Drawn here first, so focus lands where it would (the next card after a delete) before the page is drawn again.
      draw();
      if (!onPageChanged || !section.isConnected || outside() === before) return;
      refocus = document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      onPageChanged();
    };
    void work.then(done, (err: unknown) => (failed(err), done()));
  };

  function card(theme: Preset, actions?: HTMLElement): HTMLElement {
    const button = h('button', { class: 'theme-card', 'aria-pressed': String(theme.id === currentThemeId()), title: theme.description ? `${theme.name}: ${theme.description}` : theme.name }, miniature(theme.colors, theme.style), h('span', { class: 'theme-card-name' }, theme.name));
    button.addEventListener('click', () => then(chooseTheme(theme.id)));
    return actions ? h('div', { class: 'theme-card-wrap' }, button, actions) : button;
  }

  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > THEME_FILE_MAX_BYTES) return toast(t('settings.theme.file-too-large'));
    then(
      file.text().then(async (text) => {
        const theme = await importTheme(text);
        // CSS can hide the whole app: the notice says how to start without it.
        toast(t(parseThemeFile(text).css?.trim() ? 'settings.themes.added-css' : 'settings.themes.added', { name: theme.name }));
      }),
    );
  });

  function mineTools(): HTMLElement {
    if (naming) {
      const name = createTextField({
        label: t('settings.themes.name-label'),
        placeholder: t('settings.themes.name-placeholder'),
        onSubmit: (value) => {
          naming = false;
          focusAfter = saveAsButton;
          then(saveCurrentAs(value));
        },
      });
      name.maxLength = 40;
      const save = h('button', { class: 'button primary' }, t('settings.themes.save'));
      save.addEventListener('click', () => {
        naming = false;
        focusAfter = saveAsButton;
        then(saveCurrentAs(name.value));
      });
      const cancel = h('button', { class: 'button' }, t('settings.common.cancel'));
      cancel.addEventListener('click', () => ((naming = false), (focusAfter = saveAsButton), draw()));
      // "Save current…" was chosen to type a name: the field takes typing straight away (and "/" isn't Search).
      queueMicrotask(() => beginEditing(name));
      return h('div', { class: 'wallpaper-control' }, name, save, cancel);
    }
    const saveAs = h('button', { class: 'button' }, t('settings.themes.save-current'));
    saveAs.addEventListener('click', () => ((naming = true), draw()));
    const load = h('button', { class: 'button' }, t('settings.themes.import'));
    load.addEventListener('click', () => input.click());
    return h('div', { class: 'wallpaper-control' }, saveAs, load, input);
  }

  function mineCards(): HTMLElement {
    const mine = myThemes();
    if (!mine.length) return h('p', { class: 'muted theme-empty' }, t('settings.themes.empty'));
    return h(
      'div',
      { class: 'theme-grid' },
      ...mine.map((theme, index) => {
        const exportButton = h('button', { class: 'button', 'aria-label': t('settings.themes.export-label', { name: theme.name }) }, t('settings.common.export'));
        exportButton.addEventListener('click', () => void exportTheme(theme.id).then((path) => path && toast(t('settings.common.saved-to', { path })), failed));
        const remove = h('button', { class: 'button danger', 'aria-label': t('settings.themes.delete-label', { name: theme.name }) }, t('settings.themes.delete'));
        remove.addEventListener('click', () => {
          // The next theme's card takes its place (or the one before, or "Save current…").
          focusAfter = () => {
            const cards = section.querySelectorAll<HTMLElement>('.my-themes .theme-card');
            return cards[index] ?? cards[index - 1] ?? saveAsButton();
          };
          then(deleteTheme(theme.id));
        });
        return card(theme, h('div', { class: 'theme-card-actions' }, exportButton, remove));
      }),
    );
  }

  function fontsRow(): HTMLElement {
    return row(t(FONTS.label), t(FONTS.hint), inOwnTypefaces(choices(t(FONTS.label), fontOptions(), currentFonts(), (id) => void setFonts(id).catch(failed))));
  }

  function draw(): void {
    applyFonts(currentFonts());
    const tint = createSwitch('', appearance().tint, (on) => void setAppearance({ tint: on }).catch(failed));
    tint.setAttribute('aria-label', t(TINT.aria));
    const focused = document.activeElement;
    const keep = focused instanceof HTMLElement && section.contains(focused) ? focusKey(focused) : null;
    const given = refocus;
    refocus = null;

    section.replaceChildren(
      studioLink(t('settings.themes.theme'), t('settings.themes.theme-hint'), 'colours'),
      h('div', { class: 'theme-grid', role: 'group', 'aria-label': t('settings.themes.presets-label') }, ...PRESETS.map((p) => card(p))),
      // One block, so the simple view folds the cards with their row.
      h('div', { class: 'my-themes' }, row(t('settings.themes.yours'), t('settings.themes.yours-hint'), mineTools()), mineCards()),
      createAccentPanel(draw),
      playerColourRow(t('playercolour.label')),
      row(t(TINT.label), t(TINT.hint), tint),
      fontsRow(),
    );
    // Redrawing shouldn't lose keyboard focus.
    const find = (key: string) => [...section.querySelectorAll<HTMLElement>('button')].find((b) => focusKey(b) === key);
    const same = keep ? find(keep) : undefined;
    const after = focusAfter;
    focusAfter = null;
    if (same) same.focus();
    else if (keep !== null) after?.()?.focus();
    // Drawn for the whole page, which puts this section in once it's built.
    else if (given !== null) queueMicrotask(() => find(given)?.focus());
  }
  draw();
  return section;
}
