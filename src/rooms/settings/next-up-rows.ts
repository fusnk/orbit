/**
 * Settings → Playback → Next episode: when the Next Up card appears for an
 * episode whose end credits aren't known (a share of the episode, or minutes
 * before its end), and whether it's a card or a panel along the side. With
 * known credits it always comes with them. The rows read their own settings,
 * so they can sit among the autoplay rows that only show when autoplay is on.
 */
import { createSlider } from '../../components/slider';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { NEXT_UP_MINUTES, NEXT_UP_PERCENT, NEXT_UP_START, NEXT_UP_STYLES, parseNextUpAt, parseNextUpStyle, PLAYBACK_SETTINGS, type NextUpAt, type NextUpStyle } from '../player/next-up';
import { choices, row, save } from './playback';

const percent = (n: number) => new Intl.NumberFormat(locale(), { style: 'percent' }).format(n / 100);
const minutes = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(n);

/** The three rows: when (a share or minutes), how much, and the style. */
export function nextUpRows(): HTMLElement[] {
  const modeSlot = h('div', { class: 'setting-slot' });
  const valueSlot = h('div', { class: 'setting-slot' });
  const styleSlot = h('div', { class: 'setting-slot' });
  const whenRow = row(t('movix.next-up.when'), t('movix.next-up.when-hint'), modeSlot);
  const amountRow = row(t('movix.next-up.amount'), t('movix.next-up.amount-hint'), valueSlot);
  const styleRow = row(t('movix.next-up.style'), t('movix.next-up.style-hint'), styleSlot);

  void Promise.all([settings.get(PLAYBACK_SETTINGS.nextUpAt).catch(() => null), settings.get(PLAYBACK_SETTINGS.nextUpStyle).catch(() => null)]).then(([savedAt, savedStyle]) => {
    let at: NextUpAt = parseNextUpAt(savedAt);
    let timer: number | undefined;
    // A slider changes on every step while it moves: saved once it settles.
    const store = (settle: boolean) => {
      window.clearTimeout(timer);
      if (settle) timer = window.setTimeout(() => void save(PLAYBACK_SETTINGS.nextUpAt, at), 400);
      else void save(PLAYBACK_SETTINGS.nextUpAt, at);
    };
    const slider = () => {
      const range = at.mode === 'percent' ? NEXT_UP_PERCENT : NEXT_UP_MINUTES;
      const label = t('movix.next-up.amount');
      valueSlot.replaceChildren(
        createSlider({
          label,
          min: range.min,
          max: range.max,
          value: at.value,
          format: at.mode === 'percent' ? percent : minutes,
          focusId: 'next-up-amount',
          onInput: (value) => {
            at = { mode: at.mode, value };
            store(true);
          },
        }),
      );
    };
    modeSlot.replaceChildren(
      choices<NextUpAt['mode']>(
        t('movix.next-up.when'),
        [
          ['percent', t('movix.next-up.when-percent')],
          ['before-end', t('movix.next-up.when-before-end')],
        ],
        at.mode,
        (mode) => {
          if (mode === at.mode) return;
          at = { mode, value: NEXT_UP_START[mode] };
          slider();
          store(false);
        },
      ),
    );
    slider();
    const names: Record<NextUpStyle, string> = { card: t('movix.next-up.style-card'), panel: t('movix.next-up.style-panel') };
    styleSlot.replaceChildren(choices(t('movix.next-up.style'), NEXT_UP_STYLES.map((s) => [s, names[s]] as const), parseNextUpStyle(savedStyle), (v) => void save(PLAYBACK_SETTINGS.nextUpStyle, v)));
  });
  return [whenRow, amountRow, styleRow];
}
