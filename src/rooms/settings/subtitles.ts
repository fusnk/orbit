/**
 * Settings → Subtitles: the preferred language, forced subtitles, sync,
 * hearing-impaired text, AI translation (subtitle-ai.ts), and how subtitles look (with a preview); where they
 * sit, a second subtitle and timing are set in the player, as a note says.
 * And Picture & Sound → Audio: the output device, the audio language, volume levelling,
 * passthrough and tracks to skip (sound modes are the player's, noted too).
 */
import { createTextField } from '../../components/text-field';
import { AVOID_TRACKS_KEY, DEFAULT_AVOID_WORDS } from '../player/tracks';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { createSwitch } from '../../components/switch';
import { toast } from '../../components/toast';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { languageName } from '../../lib/languages';
import { LANGUAGE_CHOICES, LANGUAGE_SETTINGS, parseAudioLanguage, parseLanguages } from '../player/preferred-language';
import {
  AUDIO_NORMALIZE_KEY,
  OPACITY_MIN,
  OPACITY_STEP,
  saveSubtitleStyle,
  SIZE_DEFAULT,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_STEP,
  SUBTITLE_COLORS,
  SUBTITLE_EDGE_COLORS,
  SUBTITLE_FONTS,
  SUBTITLE_OUTLINES,
  subtitleStyle,
  type SubtitleStyle,
} from '../player/subtitle-style';
import { createSlider } from '../../components/slider';
import { applySubtitleCss } from '../player/subtitle-css';
import { onBack } from '../../app/back';
import { pushLayer } from '../../components/layers';
import { loadRankingPrefs } from '../detail/ranking-prefs';
import { AUTO_SYNC_KEY, FIX_CAPS_KEY, parsePassthrough, PASSTHROUGH_KEY, SDH_KEEP_LYRICS_KEY, STRIP_SDH_KEY, type Passthrough } from '../player/player-settings';
import { showDependents } from './dependent-rows';
import { chapter, choices, row, save } from './playback';
import { aiTranslationSection } from './subtitle-ai';
import { AUDIO_DEVICE_PREFIX, deviceChoices, deviceMissing, listAudioDevices, parseAudioDevice, sendAudioDevice, type AudioOutputs } from '../player/audio-device';
import { profileSetting } from '../../library/profiles';
import { isAndroid } from '../../lib/platform';
import { AI_SUBS_ENABLED_KEY, AI_SUBS_KEY } from '../player/subtitle-translate';

/** "50%", or "%50" in Turkish and "50 %" in French. */
const percent = (n: number) => new Intl.NumberFormat(locale(), { style: 'percent' }).format(n / 100);

/** A row of colour swatches; picking one presses it and reports its colour. */
function swatches(label: string, colours: readonly (readonly [string, string])[], current: string, onPick: (hex: string) => void): HTMLElement {
  const buttons = colours.map(([hex, name]) => {
    const swatch = h('button', { class: 'swatch', 'aria-label': name, title: name, 'aria-pressed': String(current === hex) });
    swatch.style.setProperty('--swatch', hex);
    swatch.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === swatch)));
      onPick(hex);
    });
    return swatch;
  });
  return h('div', { class: 'swatches', role: 'group', 'aria-label': label }, ...buttons);
}

/** A button that opens a menu of languages, plus `none` (the label for no preference). */
function languagePicker(label: string, key: string, current: string, none: string, onSaved: () => unknown = () => {}): HTMLElement {
  let chosen = current;
  // Drawn like the page's other values (compact.ts): what's chosen, and a chevron that opens the list.
  const button = h('button', { class: 'setting-value', 'aria-haspopup': 'menu', 'aria-label': label });
  const draw = () => button.replaceChildren(h('span', { class: 'setting-value-text' }, chosen ? languageName(chosen) : none), icon('chevronRight'));
  draw();
  button.addEventListener('click', () =>
    openMenuFrom(
      button,
      ['', ...LANGUAGE_CHOICES].map((code) => ({
        label: code ? languageName(code) : none,
        checked: () => code === chosen,
        action: () => {
          chosen = code;
          draw();
          void save(key, code).then(onSaved);
        },
      })),
      'end',
    ),
  );
  return button;
}

/**
 * The subtitle languages in order (preferred-language.ts): the first one the
 * video or an addon has is used. Each can move up or down or be removed, and
 * "Add language" offers the rest. Saved as a list; none saves '' as before.
 */
function languageList(label: string, key: string, initial: readonly string[], none: string, max = 5): HTMLElement {
  let chosen = [...initial];
  const list = h('div', { class: 'language-list', role: 'group', 'aria-label': label });
  const change = (next: string[], focus: string) => {
    chosen = next;
    void save(key, chosen.length ? chosen : '');
    draw(focus);
  };
  const draw = (focus?: string) => {
    const items = chosen.map((code, i) => {
      const name = languageName(code);
      const up = h('button', { class: 'button', 'data-focus-id': `${code}:up`, disabled: i === 0, 'aria-label': t('settings.library.move-up', { name }) }, t('settings.library.up'));
      up.addEventListener('click', () => change(chosen.map((c, j) => (j === i - 1 ? code : j === i ? chosen[i - 1]! : c)), `${code}:up`));
      const down = h('button', { class: 'button', 'data-focus-id': `${code}:down`, disabled: i === chosen.length - 1, 'aria-label': t('settings.library.move-down', { name }) }, t('settings.library.down'));
      down.addEventListener('click', () => change(chosen.map((c, j) => (j === i + 1 ? code : j === i ? chosen[i + 1]! : c)), `${code}:down`));
      const remove = h('button', { class: 'button icon-only', 'data-focus-id': `${code}:remove`, title: t('homerows.remove-row', { name }), 'aria-label': t('homerows.remove-row', { name }) }, icon('close'));
      remove.addEventListener('click', () => change(chosen.filter((c) => c !== code), 'add'));
      return h('div', { class: 'language-list-item' }, h('span', { class: 'language-list-name' }, h('span', { class: 'language-list-rank', 'aria-hidden': 'true' }, String(i + 1)), name), h('span', { class: 'language-list-controls' }, up, down, remove));
    });
    const add = h('button', { class: 'button', 'data-focus-id': 'add', disabled: chosen.length >= max, 'aria-haspopup': 'menu' }, icon('plus'), t('pages.subs.add'));
    add.addEventListener('click', () =>
      openMenuFrom(
        add,
        LANGUAGE_CHOICES.filter((code) => !chosen.includes(code)).map((code) => ({ label: languageName(code), action: () => change([...chosen, code], `${code}:remove`) })),
      ),
    );
    list.replaceChildren(...(items.length ? items : [h('span', { class: 'muted language-list-none' }, none)]), add);
    // Redrawing loses focus: back to the same control, or Add when it's gone or disabled.
    const target = focus ? (list.querySelector<HTMLButtonElement>(`[data-focus-id="${CSS.escape(focus)}"]:not(:disabled)`) ?? add) : null;
    target?.focus({ preventScroll: true });
  };
  draw();
  return list;
}

/**
 * The sound output, per profile (audio-device.ts): a menu of the system
 * default and each device mpv lists. Applied at once, and in the player on
 * every open; a saved device that isn't connected stays chosen, with a note.
 */
function devicePicker(key: string, initial: string, outputs: AudioOutputs): HTMLElement {
  let chosen = initial;
  const label = t('audiodevice.title');
  const choicesNow = deviceChoices(outputs.devices, t('audiodevice.default'));
  const button = h('button', { class: 'setting-value', 'aria-haspopup': 'menu', 'aria-label': label });
  const draw = () => button.replaceChildren(h('span', { class: 'setting-value-text' }, deviceMissing(chosen, outputs.devices) ? t('audiodevice.missing') : (choicesNow.find((c) => c.name === chosen)?.label ?? t('audiodevice.default'))), icon('chevronRight'));
  draw();
  button.addEventListener('click', () =>
    openMenuFrom(
      button,
      choicesNow.map((c) => ({
        label: c.label,
        checked: () => c.name === chosen,
        action: () => {
          chosen = c.name;
          draw();
          void save(key, c.name);
          sendAudioDevice(c.name).catch((err: unknown) => {
            console.error('Could not change the sound output', err);
            toast(t('audiodevice.error'));
          });
        },
      })),
      'end',
    ),
  );
  return button;
}

/** Picture & Sound → Audio. */
export function soundPanel(): HTMLElement {
  const panel = h('div', {});
  // Desktop only: Android's own player plays wherever the TV sends sound.
  const output = isAndroid
    ? Promise.resolve(null)
    : Promise.all([profileSetting(AUDIO_DEVICE_PREFIX), listAudioDevices()]).catch((err: unknown) => {
        console.warn('Could not list sound outputs', err);
        return null;
      });
  const saved = Promise.all([AUDIO_NORMALIZE_KEY, LANGUAGE_SETTINGS.audio, AVOID_TRACKS_KEY, PASSTHROUGH_KEY, LANGUAGE_SETTINGS.originalAudio].map((key) => settings.get(key).catch(() => undefined)));
  void Promise.all([saved, output]).then(([[normalize, audioLanguage, avoid, passthrough, originalAudio], device]) => {
    const level = createSwitch('', normalize === true, (on) =>
      settings.set(AUDIO_NORMALIZE_KEY, on).catch((err: unknown) => {
        console.error('Could not save setting', err);
        toast(t('settings.common.save-failed'));
      }),
    );
    level.setAttribute('aria-label', t('settings.subtitles.normalize'));
    const original = createSwitch('', originalAudio === true, (on) =>
      settings.set(LANGUAGE_SETTINGS.originalAudio, on).catch((err: unknown) => {
        console.error('Could not save setting', err);
        toast(t('settings.common.save-failed'));
      }),
    );
    original.setAttribute('aria-label', t('prfixes.audio.original'));
    const passthroughChoices: readonly (readonly [Passthrough, string])[] = [
      ['off', t('settings.common.off')],
      ['dolby-dts', t('settings.subtitles.passthrough-dolby-dts')],
      ['all', t('settings.subtitles.passthrough-all')],
    ];
    panel.replaceChildren(
      h('h3', { class: 'settings-subheading' }, t('settings.subtitles.audio-heading')),
      h('p', { class: 'muted settings-intro' }, t('settings.sound.in-player')),
      ...(device ? [row(t('audiodevice.title'), t('audiodevice.hint'), devicePicker(device[0].key, parseAudioDevice(device[0].value), device[1]))] : []),
      row(
        t('settings.subtitles.audio-language'),
        t('settings.subtitles.audio-language-hint'),
        languagePicker(t('settings.subtitles.audio-language'), LANGUAGE_SETTINGS.audio, parseAudioLanguage(audioLanguage), t('settings.subtitles.video-default'), loadRankingPrefs),
      ),
      row(t('prfixes.audio.original'), t('prfixes.audio.original-hint'), original),
      row(t('settings.subtitles.normalize'), t('settings.subtitles.normalize-hint'), level),
      row(
        t('settings.subtitles.passthrough'),
        t('settings.subtitles.passthrough-hint'),
        choices(t('settings.subtitles.passthrough'), passthroughChoices, parsePassthrough(passthrough), (v) => void save(PASSTHROUGH_KEY, v)),
      ),
      row(
        t('settings.subtitles.avoid'),
        t('settings.subtitles.avoid-hint'),
        avoidField(typeof avoid === 'string' ? avoid : DEFAULT_AVOID_WORDS),
      ),
    );
  });
  return panel;
}

export function subtitlesPanel(): HTMLElement {
  const panel = h('div', { class: 'settings-split' });
  void Promise.all([
    subtitleStyle(),
    settings.get(LANGUAGE_SETTINGS.subtitle).catch(() => undefined),
    settings.get(LANGUAGE_SETTINGS.forcedOnly).catch(() => undefined),
    settings.get(AUTO_SYNC_KEY).catch(() => undefined),
    settings.get(STRIP_SDH_KEY).catch(() => undefined),
    settings.get(SDH_KEEP_LYRICS_KEY).catch(() => undefined),
    settings.get(FIX_CAPS_KEY).catch(() => undefined),
    settings.get(AI_SUBS_ENABLED_KEY).catch(() => undefined),
    settings.get(AI_SUBS_KEY).catch(() => undefined),
  ]).then(([initial, subtitleLanguage, forcedOnly, autoSync, stripSdh, keepLyrics, fixCaps, aiEnabled, aiPrefs]) => {
    let style = initial;
    const sampleText = `${t('subfonts.line1')}
${t('subfonts.line2')}`;
    const preview = h('div', { class: 'subtitle-preview', 'aria-hidden': 'true' }, h('span', { class: 'subtitle-sample' }, sampleText));
    /** The full-screen preview while it's open, so changes reach it too. */
    let full: HTMLElement | null = null;

    function drawPreview(): void {
      applySubtitleCss(preview, style);
      if (full) applySubtitleCss(full, style);
    }

    /** The same sample over the whole window, at the size the player would draw it; Back (Escape) or a click closes it. */
    function openFullPreview(): void {
      const returnFocus = document.activeElement;
      full = h('button', { class: 'subtitle-preview subtitle-preview-full', 'aria-label': t('subfonts.fullscreen-close') }, h('span', { class: 'subtitle-sample', 'aria-hidden': 'true' }, sampleText), h('span', { class: 'subtitle-preview-close' }, t('subfonts.fullscreen-close')));
      const overlay = full;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        removeBack();
        removeLayer();
        overlay.remove();
        full = null;
        if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      };
      overlay.addEventListener('click', close);
      const removeBack = onBack(close);
      drawPreview();
      document.body.append(overlay);
      const removeLayer = pushLayer(overlay, close);
      overlay.focus({ preventScroll: true });
    }
    const fullButton = h('button', { class: 'button' }, icon('fullscreen'), t('subfonts.fullscreen'));
    fullButton.addEventListener('click', openFullPreview);

    let timer: number | undefined;
    const store = () => {
      window.clearTimeout(timer);
      saveSubtitleStyle(style).catch((err: unknown) => {
        console.error('Could not save setting', err);
        toast(t('settings.common.save-failed'));
      });
    };
    /** Previews at once; a slider (`settle`), which changes on every step while it moves, is saved once it rests. */
    const update = (patch: Partial<SubtitleStyle>, settle = false) => {
      style = { ...style, ...patch };
      drawPreview();
      window.clearTimeout(timer);
      if (settle) timer = window.setTimeout(store, 400);
      else store();
    };

    const colours = swatches(t('settings.subtitles.colour-label'), SUBTITLE_COLORS, style.color, (color) => update({ color }));
    // The size relative to mpv's default, which reads as 100%.
    const size = createSlider({ label: t('settings.subtitles.size-label'), min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: style.size, format: (v) => percent(Math.round((v / SIZE_DEFAULT) * 100)), focusId: 'subtitle-size', onInput: (v) => update({ size: v }, true) });
    const opacity = createSlider({ label: t('subs.style.opacity'), min: OPACITY_MIN, max: 100, step: OPACITY_STEP, value: style.opacity, format: percent, focusId: 'subtitle-opacity', onInput: (v) => update({ opacity: v }, true) });
    const outlineColour = swatches(t('subs.style.outline-colour'), SUBTITLE_EDGE_COLORS, style.outlineColor, (outlineColor) => update({ outlineColor }));
    // The box's colour and opacity only show while the background is a box.
    const backColour = swatches(t('subs.style.box-colour'), SUBTITLE_EDGE_COLORS, style.backColor, (backColor) => update({ backColor }));
    const backOpacity = createSlider({ label: t('subs.style.box-opacity'), min: 0, max: 100, step: OPACITY_STEP, value: style.backOpacity, format: percent, focusId: 'subtitle-box-opacity', onInput: (v) => update({ backOpacity: v }, true) });
    const backColourRow = row(t('subs.style.box-colour'), '', backColour);
    const backOpacityRow = row(t('subs.style.box-opacity'), t('subs.style.box-opacity-hint'), backOpacity);
    const bold = createSwitch('', style.bold, (on) => update({ bold: on }));
    bold.setAttribute('aria-label', t('settings.subtitles.bold-label'));
    // Each font shows its own name in that font (the default in the player's default font, the page can't know).
    const fonts = SUBTITLE_FONTS.map(([id, label, family]) => {
      const button = h('button', { class: 'subtitle-font', 'aria-pressed': String(style.font === id) }, label);
      if (family) button.style.fontFamily = family;
      button.addEventListener('click', () => {
        fonts.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        update({ font: id });
      });
      return button;
    });

    const sync = createSwitch('', autoSync === true, (on) => void save(AUTO_SYNC_KEY, on));
    sync.setAttribute('aria-label', t('settings.subtitles.auto-sync'));
    // Lyrics only matter while hearing-impaired text is removed.
    const lyrics = createSwitch('', keepLyrics !== false, (on) => void save(SDH_KEEP_LYRICS_KEY, on));
    lyrics.setAttribute('aria-label', t('subs.settings.keep-lyrics'));
    const lyricsRow = row(t('subs.settings.keep-lyrics'), t('subs.settings.keep-lyrics-hint'), lyrics);
    const sdh = createSwitch('', stripSdh === true, (on) => {
      showDependents(sdhRow, [lyricsRow], on);
      void save(STRIP_SDH_KEY, on);
    });
    sdh.setAttribute('aria-label', t('subs.settings.strip-sdh'));
    const sdhRow = row(t('subs.settings.strip-sdh'), t('subs.settings.strip-sdh-hint'), sdh);
    showDependents(sdhRow, [lyricsRow], stripSdh === true);
    const caps = createSwitch('', fixCaps === true, (on) => void save(FIX_CAPS_KEY, on));
    caps.setAttribute('aria-label', t('playertools.caps.setting'));

    drawPreview();
    const backgroundRow = row(
      t('settings.subtitles.background'),
      t('settings.subtitles.background-hint'),
      choices(
        t('settings.subtitles.background-label'),
        [
          ['none', t('settings.subtitles.background-none')],
          ['shadow', t('settings.subtitles.background-shadow')],
          ['box', t('settings.subtitles.background-box')],
        ] as const,
        style.background,
        (background) => {
          update({ background });
          showDependents(backgroundRow, [backColourRow, backOpacityRow], background === 'box');
        },
      ),
    );
    // The sample sits beside the whole page (settings-split, settings.css), so every change shows as it's made.
    panel.replaceChildren(
      h(
        'div',
        { class: 'settings-split-main' },
        chapter('settingslayout.chapter.subtitle-text'),
        row(
          t('settings.subtitles.subtitle-language'),
          `${t('settings.subtitles.subtitle-language-hint')} ${t('pages.subs.order-hint')}`,
          languageList(t('settings.subtitles.subtitle-language'), LANGUAGE_SETTINGS.subtitle, parseLanguages(subtitleLanguage), t('settings.subtitles.video-default')),
        ),
        row(
          t('settings.subtitles.forced'),
          t('settings.subtitles.forced-hint'),
          choices(t('settings.subtitles.forced'), [[false, t('settings.subtitles.forced-show')], [true, t('settings.subtitles.forced-only')]] as const, forcedOnly === true, (v) => void save(LANGUAGE_SETTINGS.forcedOnly, v)),
        ),
        row(t('settings.subtitles.auto-sync'), t('settings.subtitles.auto-sync-hint'), sync),
        sdhRow,
        lyricsRow,
        row(t('playertools.caps.setting'), t('playertools.caps.hint'), caps),
        ...aiTranslationSection(aiEnabled, aiPrefs),
        h('h3', { class: 'settings-subheading appearance-section' }, t('settings.subtitles.style-heading')),
        h('p', { class: 'muted settings-intro subtitle-style-intro' }, t('settings.subtitles.style-intro'), ' ', t('settings.subtitles.in-player')),
        row(t('subfonts.font'), t('subfonts.font-hint'), h('div', { class: 'subtitle-fonts', role: 'group', 'aria-label': t('subfonts.font-label') }, ...fonts)),
        row(t('settings.subtitles.size-label'), '', size),
        row(t('settings.subtitles.colour'), '', colours),
        row(t('subs.style.opacity'), '', opacity),
        backgroundRow,
        backColourRow,
        backOpacityRow,
        row(t('settings.subtitles.outline'), '', choices(t('settings.subtitles.outline-label'), SUBTITLE_OUTLINES, style.outline, (outline) => update({ outline }))),
        row(t('subs.style.outline-colour'), '', outlineColour),
        row(t('settings.subtitles.bold'), '', bold),
      ),
      h('aside', { class: 'settings-split-aside subtitle-preview-panel', 'aria-label': t('settingslayout.preview') }, h('h3', { class: 'settings-preview-heading' }, t('settingslayout.preview')), preview, row(t('subfonts.preview'), t('subfonts.preview-hint'), fullButton)),
    );
    showDependents(backgroundRow, [backColourRow, backOpacityRow], style.background === 'box');
  });
  return panel;
}

/** The words to skip, saved as typed (after the field loses focus). */
function avoidField(initial: string): HTMLElement {
  const field = createTextField({ label: t('settings.subtitles.avoid'), placeholder: t('settings.subtitles.avoid-placeholder'), onSubmit: () => field.blur() });
  field.value = initial;
  field.classList.add('avoid-field');
  field.addEventListener('change', () => void save(AVOID_TRACKS_KEY, field.value.slice(0, 300)));
  return field;
}
