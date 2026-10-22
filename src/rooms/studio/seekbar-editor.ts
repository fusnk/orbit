/**
 * The seek bar's style (theme/seekbar.ts), in Theme Studio → Look (where it's
 * edited; Settings → Player links there, and shows the colour swatches): a sample
 * bar on a dark strip that shows every change, then the bar's pattern,
 * height, colour and picture, the buffered part, and the dot.
 */
import { createSwitch } from '../../components/switch';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { parseHex } from '../../theme/accent';
import { SEEK_BUFFERED, SEEK_DOT_SIZE, SEEK_DOTS, SEEK_HEIGHT, SEEK_IMAGE_MAX_BYTES, SEEK_IMAGE_TYPES, SEEK_STYLES, SEEK_SWATCHES, uploadSeekImage, type SeekBar } from '../../theme/seekbar';
import { field, filePicker, redrawKeepingFocus, segments, slider } from './controls';
import { errorText } from '../../components/state-message';

const STYLE_LABELS = { flat: 'studio.seek.style-flat', glass: 'studio.seek.style-glass', pinstripe: 'studio.seek.style-pinstripe', rainbow: 'studio.seek.style-rainbow' } as const;
const DOT_LABELS = { circle: 'studio.seek.dot-circle', square: 'studio.seek.dot-square', image: 'studio.seek.dot-image', hidden: 'studio.seek.dot-hidden' } as const;

/** A seek bar as the player draws it (same classes, so seekbar.css styles it), stopped part-way. */
export function seekSample(): HTMLElement {
  const part = (className: string, fraction: number) => {
    const el = h('span', { class: className });
    el.style.setProperty('--fraction', String(fraction));
    return el;
  };
  return h('div', { class: 'seek-sample-strip', role: 'img', 'aria-label': t('studio.seek.preview-label') }, h('div', { class: 'seek seek-sample' }, h('span', { class: 'seek-track' }, part('seek-buffered', 0.68), part('seek-fill', 0.42), part('seek-knob', 0.42))));
}

/**
 * The bar's colour: "Accent" (null), the ready-made swatches, and any colour
 * from the system picker. The Studio's editor and Settings' "Player colour"
 * rows both use it; `show` marks another colour chosen without drawing again
 * (a redraw would close the system picker while it's open).
 */
export function seekColourSwatches(initial: string | null, options: { preview(color: string): void; commit(color: string | null): void }): { element: HTMLElement; show(color: string | null): void } {
  const swatch = (hex: string | null, label: string) => {
    const button = h('button', { class: 'swatch', 'aria-label': label, title: label, 'data-studio-key': `seek:color:${hex ?? 'accent'}` });
    button.style.setProperty('--swatch', hex ?? 'var(--color-accent)');
    if (!hex) button.classList.add('seek-accent-swatch');
    button.addEventListener('click', () => options.commit(hex));
    return [hex, button] as const;
  };
  const swatches = [swatch(null, t('studio.seek.color-accent')), ...SEEK_SWATCHES.map((hex) => swatch(hex, t('studio.seek.color-swatch', { value: hex })))];
  const custom = h('input', { type: 'color', class: 'swatch custom-swatch', 'aria-label': t('studio.seek.color-custom'), title: t('studio.seek.color-custom'), 'data-studio-key': 'seek:color:custom' });
  custom.addEventListener('input', () => {
    const color = parseHex(custom.value);
    if (color) options.preview(color);
  });
  custom.addEventListener('change', () => options.commit(parseHex(custom.value)));

  function show(color: string | null): void {
    for (const [hex, button] of swatches) button.setAttribute('aria-pressed', String(color === hex));
    custom.value = color ?? '#ffffff';
    custom.setAttribute('aria-pressed', String(!!color && !SEEK_SWATCHES.includes(color as (typeof SEEK_SWATCHES)[number])));
  }
  show(initial);
  return { element: h('div', { class: 'swatches studio-swatches', role: 'group', 'aria-label': t('studio.seek.color') }, ...swatches.map(([, button]) => button), custom), show };
}

/**
 * `preview` shows a change in progress (a slider moving), `commit` a
 * finished one; both get the whole new style.
 */
export function seekBarEditor(initial: SeekBar, options: { preview(bar: SeekBar): void; commit(bar: SeekBar): void }): HTMLElement {
  let bar = initial;
  const element = h('div', { class: 'seek-editor' });

  const commit = (patch: Partial<SeekBar>) => {
    bar = { ...bar, ...patch };
    options.commit(bar);
    redrawKeepingFocus(element, draw);
  };
  const live = (patch: Partial<SeekBar>) => {
    bar = { ...bar, ...patch };
    options.preview(bar);
  };
  const px = (value: number) => t('studio.seek.pixels', { value });

  function upload(which: 'barImage' | 'dotImage') {
    return filePicker(SEEK_IMAGE_TYPES, (file) => {
      if (file.size > SEEK_IMAGE_MAX_BYTES) return toast(t('studio.seek.too-large'));
      uploadSeekImage(file)
        .then((name) => commit(which === 'dotImage' ? { dotImage: name, dot: 'image' } : { barImage: name }))
        .catch((err: unknown) => toast(errorText(err)));
    });
  }

  function pictureControls(which: 'barImage' | 'dotImage'): HTMLElement {
    const picker = upload(which);
    const choose = h('button', { class: 'button', 'data-studio-key': `seek:${which}:choose` }, bar[which] ? t('studio.seek.change') : t('studio.seek.upload'));
    choose.addEventListener('click', picker.open);
    const remove = h('button', { class: 'button danger', hidden: !bar[which], 'data-studio-key': `seek:${which}:remove` }, t('studio.seek.remove'));
    remove.addEventListener('click', () => {
      commit(which === 'dotImage' ? { dotImage: null, dot: 'circle' } : { barImage: null });
      // This button is gone now (hidden, or the dot's picture row with it), so it can't keep the focus: what replaced the picture takes it.
      element.querySelector<HTMLElement>(`[data-studio-key="${which === 'dotImage' ? 'seek:dot:0' : 'seek:barImage:choose'}"]`)?.focus({ preventScroll: true });
    });
    return h('div', { class: 'studio-inline' }, choose, remove, picker.input);
  }

  function draw(): void {
    const buffered = createSwitch('', bar.buffered, (on) => commit({ buffered: on }));
    buffered.setAttribute('aria-label', t('studio.seek.buffered'));
    buffered.dataset.studioKey = 'seek:buffered';
    element.replaceChildren(
      seekSample(),
      field(
        t('studio.seek.style'),
        null,
        segments(
          t('studio.seek.style'),
          SEEK_STYLES.map((s) => [s, t(STYLE_LABELS[s])] as const),
          bar.style,
          (style) => commit({ style }),
          'seek:style',
        ),
      ),
      field(t('studio.seek.height'), null, slider({ label: t('studio.seek.height'), ...SEEK_HEIGHT, value: bar.height, format: px, onInput: (height) => live({ height }), onChange: (height) => commit({ height }), key: 'seek:height' })),
      field(t('studio.seek.color'), null, seekColourSwatches(bar.color, { preview: (color) => live({ color }), commit: (color) => commit({ color }) }).element),
      field(t('studio.seek.image'), t('studio.seek.image-hint'), pictureControls('barImage')),
      h('div', { class: 'studio-field studio-field-row' }, h('span', { class: 'studio-field-label' }, t('studio.seek.buffered')), buffered),
      bar.buffered
        ? field(
            t('studio.seek.buffered-brightness'),
            null,
            slider({
              label: t('studio.seek.buffered-brightness'),
              ...SEEK_BUFFERED,
              value: bar.bufferedBrightness,
              format: (value) => t('studio.seek.percent', { value }),
              onInput: (bufferedBrightness) => live({ bufferedBrightness }),
              onChange: (bufferedBrightness) => commit({ bufferedBrightness }),
              key: 'seek:buffered-brightness',
            }),
          )
        : '',
      field(
        t('studio.seek.dot'),
        null,
        segments(
          t('studio.seek.dot'),
          SEEK_DOTS.map((d) => [d, t(DOT_LABELS[d])] as const),
          bar.dot,
          (dot) => commit({ dot }),
          'seek:dot',
        ),
      ),
      bar.dot === 'hidden' ? '' : field(t('studio.seek.dot-size'), null, slider({ label: t('studio.seek.dot-size'), ...SEEK_DOT_SIZE, value: bar.dotSize, format: px, onInput: (dotSize) => live({ dotSize }), onChange: (dotSize) => commit({ dotSize }), key: 'seek:dot-size' })),
      bar.dot === 'image' ? field(t('studio.seek.dot-picture'), t('studio.seek.dot-picture-hint'), pictureControls('dotImage')) : '',
    );
  }
  draw();
  return element;
}
