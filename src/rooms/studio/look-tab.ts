/**
 * Theme Studio → Look: the theme's name and tagline, a preset to start from,
 * every colour (swatch and hex, with where it's used), fonts, the appearance
 * switches that change how things look, and the seek bar. The colours and
 * the seek bar are edited only here; Settings links to them.
 */
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { parseHex } from '../../theme/accent';
import type { Look } from '../../theme/engine';
import { COLOR_KEYS, COLOR_LABELS, PRESETS, readabilityWarnings, TAGLINE_MAX, type ColorKey } from '../../theme/palette';
import { field, section, segments } from './controls';
import { CORNERS, DETAIL_BACKGROUND, FONTS, fontOptions, GLOW, HERO_STYLE, inOwnTypefaces, optionsOf, POSTER_SIZE, TINT, type LookChoice } from './look-choices';
import { seekBarEditor } from './seekbar-editor';

let seekEdit = 0;

/** Marks a section as a place Theme Studio can be opened at (see openThemeStudio). */
function place(element: HTMLElement, id: string): HTMLElement {
  element.dataset.studioSection = id;
  return element;
}

export type Change = (look: Look, options?: { group?: string; redraw?: boolean }) => void;

const COLOR_HINTS: Record<ColorKey, MessageKey> = {
  bg: 'studio.color.bg',
  panel: 'studio.color.panel',
  raised: 'studio.color.raised',
  text: 'studio.color.text',
  muted: 'studio.color.muted',
  faint: 'studio.color.faint',
  danger: 'studio.color.danger',
  accent: 'studio.color.accent',
};

/** A text field that applies as it's typed (one undo step per field) and keeps its own value. */
function liveText(label: string, value: string, max: number, placeholder: string, key: string, onText: (value: string) => void): HTMLInputElement {
  const input = createTextField({ label, placeholder, onSubmit: () => input.blur() });
  input.value = value;
  input.maxLength = max;
  input.dataset.studioKey = key;
  input.addEventListener('input', () => onText(input.value));
  return input;
}

export function lookTab(look: Look, change: Change): HTMLElement {
  const set = (patch: Partial<Look>, options?: { group?: string; redraw?: boolean }) => change({ ...look, ...patch }, options);
  const setAppearance = (patch: Partial<Look['appearance']>) => set({ appearance: { ...look.appearance, ...patch } });

  // ── Identity
  const name = liveText(t('studio.name'), look.name, 40, t('studio.name-placeholder'), 'name', (value) => {
    look = { ...look, name: value };
    change(look, { group: 'name', redraw: false });
  });
  const tagline = liveText(t('studio.tagline'), look.tagline, TAGLINE_MAX, t('studio.tagline-placeholder'), 'tagline', (value) => {
    look = { ...look, tagline: value };
    change(look, { group: 'tagline', redraw: false });
  });

  // ── Start from a preset
  const same = (a: Look['colors'], b: Look['colors']) => COLOR_KEYS.every((key) => a[key] === b[key]);
  const presets = h(
    'div',
    { class: 'chips studio-presets', role: 'group', 'aria-label': t('studio.start-from') },
    ...PRESETS.map((preset) => {
      const dots = h('span', { class: 'studio-preset-dots', 'aria-hidden': 'true' }, ...(['bg', 'panel', 'accent'] as const).map((key) => {
        const dot = h('span', {});
        dot.style.setProperty('background', preset.colors[key]);
        return dot;
      }));
      const pressed = same(preset.colors, look.colors) && (preset.style ?? null) === look.style;
      const chip = h('button', { class: 'chip studio-preset', 'aria-pressed': String(pressed), 'data-studio-key': `preset:${preset.id}`, ...(preset.description ? { title: preset.description } : {}) }, dots, preset.name);
      // A preset's style comes with its colours; starting from one without leaves none.
      chip.addEventListener('click', () => set({ colors: { ...preset.colors }, style: preset.style ?? null }));
      return chip;
    }),
  );

  // ── Colours
  const warnings = h('ul', { class: 'theme-warnings', role: 'status' });
  const showWarnings = () => warnings.replaceChildren(...readabilityWarnings(look.colors).map((w) => h('li', {}, w)));
  showWarnings();
  const colourRows = COLOR_KEYS.map((key) => {
    const picker = h('input', { type: 'color', class: 'theme-color', value: look.colors[key], 'aria-label': COLOR_LABELS[key], 'data-studio-key': `color:${key}` });
    const hex = createTextField({ label: t('studio.hex-label', { name: COLOR_LABELS[key] }), placeholder: '#000000', className: 'hex-field', onSubmit: () => hex.blur() });
    hex.value = look.colors[key];
    hex.maxLength = 7;
    hex.dataset.studioKey = `hex:${key}`;
    const apply = (value: string, from: 'picker' | 'hex') => {
      look = { ...look, colors: { ...look.colors, [key]: value } };
      if (from === 'picker') hex.value = value;
      else picker.value = value;
      showWarnings();
      change(look, { group: `color:${key}`, redraw: false });
    };
    picker.addEventListener('input', () => apply(picker.value, 'picker'));
    hex.addEventListener('input', () => {
      const value = parseHex(hex.value);
      hex.classList.toggle('invalid', !value);
      if (value && value !== look.colors[key]) apply(value, 'hex');
    });
    hex.addEventListener('blur', () => {
      hex.value = look.colors[key];
      hex.classList.remove('invalid');
    });
    return h(
      'div',
      { class: 'studio-color' },
      picker,
      h('div', { class: 'studio-color-text' }, h('span', { class: 'studio-field-label' }, COLOR_LABELS[key]), h('span', { class: 'studio-field-hint' }, t(COLOR_HINTS[key]))),
      hex,
    );
  });

  // ── Fonts and switches (defined once with Settings → Appearance's, in look-choices.ts)
  const fonts = inOwnTypefaces(segments(t(FONTS.label), fontOptions(), look.fonts, (fonts) => set({ fonts }), 'fonts'));
  const tint = createSwitch('', look.appearance.tint, (on) => setAppearance({ tint: on }));
  tint.setAttribute('aria-label', t(TINT.aria));
  tint.dataset.studioKey = 'tint';
  const pick = <K extends keyof Look['appearance']>(choice: LookChoice<K>) =>
    field(t(choice.label), t(choice.hint), segments(t(choice.label), optionsOf(choice), look.appearance[choice.field], (value) => setAppearance({ [choice.field]: value }), choice.key));

  return h(
    'div',
    { class: 'studio-tab' },
    section(t('studio.identity'), field(t('studio.name'), null, name), field(t('studio.tagline'), null, tagline)),
    section(t('studio.start-from'), h('p', { class: 'studio-field-hint' }, t('studio.start-from-hint')), presets),
    place(section(t('studio.colours'), ...colourRows, warnings), 'colours'),
    section(
      t('studio.type-and-finish'),
      field(t(FONTS.label), t(FONTS.hint), fonts),
      h('div', { class: 'studio-field studio-field-row' }, h('div', { class: 'studio-field-text' }, h('span', { class: 'studio-field-label' }, t(TINT.label)), h('span', { class: 'studio-field-hint' }, t(TINT.hint))), tint),
      pick(GLOW),
      pick(CORNERS),
      pick(POSTER_SIZE),
      pick(HERO_STYLE),
      pick(DETAIL_BACKGROUND),
    ),
    place(
      section(
        t('studio.seek.heading'),
        h('p', { class: 'studio-field-hint' }, t('studio.seek.hint')),
        seekBarEditor(look.seekbar, {
          // A slider's moves and its release are one step; the next edit starts another.
          preview: (seekbar) => change({ ...look, seekbar }, { group: `seekbar:${seekEdit}`, redraw: false }),
          commit: (seekbar) => {
            look = { ...look, seekbar };
            change(look, { group: `seekbar:${seekEdit++}`, redraw: false });
          },
        }),
      ),
      'seekbar',
    ),
  );
}
