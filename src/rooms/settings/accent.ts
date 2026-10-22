import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { ACCENT_PRESETS, currentAccent, parseHex, THEME_ACCENT, type AccentChoice } from '../../theme/accent';
import { currentAccentChoice, currentColors, currentLook, setAccent, themeAccent } from '../../theme/engine';

/**
 * Appearance → Accent: "Theme's colour" first (the active theme's own accent,
 * drawn as a ring around the theme's background), one round swatch per
 * preset (the chosen one gets a white ring), plus any colour from Windows'
 * colour picker or a hex code.
 */
export function createAccentPanel(onChange?: () => void): HTMLElement {
  const save = (choice: AccentChoice) =>
    setAccent(choice)
      .catch((err: unknown) => console.error('Could not save accent', err))
      .finally(onChange ?? sync);

  const themeSwatch = h('button', { class: 'swatch theme-swatch' });
  themeSwatch.addEventListener('click', () => void save(THEME_ACCENT));
  const swatches = ACCENT_PRESETS.map((preset) => {
    const swatch = h('button', { class: 'swatch', 'data-hex': preset.hex, 'aria-label': preset.label, title: preset.label });
    swatch.style.setProperty('--swatch', preset.hex);
    swatch.addEventListener('click', () => void save(preset.hex));
    return swatch;
  });

  const picker = h('input', { type: 'color', class: 'swatch custom-swatch', 'aria-label': t('settings.accent.custom'), title: t('settings.accent.custom') });
  picker.addEventListener('change', () => void save(picker.value));
  const hex = createTextField({
    label: t('settings.accent.hex-label'),
    placeholder: '#e5484d',
    className: 'hex-field',
    onSubmit: (value) => {
      const parsed = parseHex(value);
      if (parsed) void save(parsed);
      else toast(t('settings.accent.hex-invalid'));
    },
  });
  hex.maxLength = 7;

  function sync(): void {
    const choice = currentAccentChoice();
    const accent = currentAccent();
    const name = t('settings.accent.theme-title', { name: currentLook().name });
    themeSwatch.style.setProperty('--swatch', themeAccent());
    themeSwatch.style.setProperty('--swatch-bg', currentColors().bg);
    themeSwatch.setAttribute('aria-label', name);
    themeSwatch.title = name;
    themeSwatch.setAttribute('aria-pressed', String(choice === THEME_ACCENT));
    for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.hex === choice));
    const custom = choice !== THEME_ACCENT && !ACCENT_PRESETS.some((p) => p.hex === choice);
    picker.value = accent;
    picker.setAttribute('aria-pressed', String(custom));
    if (document.activeElement !== hex) hex.value = accent;
  }
  sync();

  return h(
    'div',
    { class: 'setting-row' },
    h('div', { class: 'setting-text' }, h('span', { class: 'setting-label' }, t('settings.accent.accent')), h('span', { class: 'setting-hint' }, `${t('settings.accent.hint')} ${t('settings.accent.theme-hint')}`)),
    h('div', { class: 'swatches', role: 'group', 'aria-label': t('settings.accent.group-label') }, themeSwatch, ...swatches, picker, hex),
  );
}
