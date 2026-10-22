/**
 * Settings → Downloads: where new downloads go, the highest quality "Best
 * source" downloads at, a speed limit, the hours downloads may run, and how
 * much space downloads take.
 *
 * The folder is picked with the system's folder dialog (opened by Rust), or
 * typed or pasted; either way Rust checks that it exists and can be written
 * before using it.
 */
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { icon } from '../../components/icons';
import { KEEP_COUNT_KEY, KEEP_COUNTS, parseKeepCount } from '../../library/auto-downloads';
import { DEFAULT_WINDOW, hourLabel, parseSpeedLimit, parseWindow, SPEED_LIMIT_KEY, SPEED_LIMITS, stepHour, WINDOW_KEY, type DownloadWindow } from '../../library/download-schedule';
import { applyDownloadSchedule, failureText, formatBytes, MAX_QUALITIES, parseMaxQuality, pickFolder, QUALITY_KEY, setFolder, storage, type MaxQuality } from '../../library/downloads';
import { choices, row, save } from '../settings/playback';
import './title-downloads.css';

const QUALITY_LABELS: Record<MaxQuality, string> = {
  original: t('downloads.settings.original'),
  '2160p': '4K',
  '1080p': '1080p',
  '720p': '720p',
};

const megabytesPerSecond = (n: number) => new Intl.NumberFormat(locale(), { style: 'unit', unit: 'megabyte-per-second', unitDisplay: 'short' }).format(n);
const SPEED_CHOICES = SPEED_LIMITS.map((n) => [n, n === 0 ? t('settings.common.off') : megabytesPerSecond(n)] as const);

/** Saves a schedule setting and hands it to Rust at once. */
const saveSchedule = (key: string, value: unknown) =>
  save(key, value).then(() =>
    applyDownloadSchedule().catch((err: unknown) => {
      console.error('Could not apply the download schedule', err);
      toast(t('settings.common.save-failed'));
    }),
  );

/** An hour with earlier/later buttons (not a <select>: arrows on one would change it while moving past). */
function hourStepper(label: string, hour: number, onChange: (hour: number) => void): HTMLElement {
  const value = h('output', { class: 'hour-stepper-value', 'aria-live': 'polite' }, hourLabel(hour));
  const step = (delta: number) => {
    hour = stepHour(hour, delta);
    value.textContent = hourLabel(hour);
    onChange(hour);
  };
  const earlier = h('button', { class: 'icon-button', title: t('downloads.schedule.earlier', { label }), 'aria-label': t('downloads.schedule.earlier', { label }) }, icon('chevronLeft'));
  earlier.addEventListener('click', () => step(-1));
  const later = h('button', { class: 'icon-button', title: t('downloads.schedule.later', { label }), 'aria-label': t('downloads.schedule.later', { label }) }, icon('chevronRight'));
  later.addEventListener('click', () => step(1));
  return h('div', { class: 'hour-stepper', role: 'group', 'aria-label': label }, h('span', { class: 'setting-hint' }, label), earlier, value, later);
}

/** "Only download between": a switch, and while it's on, from one hour to another (across midnight too). */
function windowRow(saved: unknown): HTMLElement {
  let current: DownloadWindow | null = parseWindow(saved);
  let hours: DownloadWindow = current ?? DEFAULT_WINDOW;
  const range = h('div', { class: 'hour-range', hidden: !current });
  const persist = () => void saveSchedule(WINDOW_KEY, current);
  range.append(
    hourStepper(t('downloads.schedule.from'), hours.start, (start) => {
      hours = { ...hours, start };
      current = hours;
      persist();
    }),
    hourStepper(t('downloads.schedule.to'), hours.end, (end) => {
      hours = { ...hours, end };
      current = hours;
      persist();
    }),
  );
  const toggle = createSwitch('', current !== null, (on) => {
    current = on ? hours : null;
    range.hidden = !on;
    persist();
  });
  toggle.setAttribute('aria-label', t('downloads.schedule.window'));
  // The switch sits where every switch does; the hours open under the text.
  const element = row(t('downloads.schedule.window'), t('downloads.schedule.window-hint'), toggle);
  element.querySelector('.setting-text')?.append(range);
  return element;
}

export function downloadsPanel(): HTMLElement {
  const folderHint = h('span', { class: 'setting-hint mono download-folder-path' });
  const storageHint = h('span', { class: 'setting-hint' });
  const change = h('button', { class: 'button' }, t('downloads.settings.change'));
  const typePath = h('button', { class: 'button', 'aria-expanded': 'false' }, t('downloads.settings.type-path'));
  const reset = h('button', { class: 'button', hidden: true }, t('downloads.settings.reset'));
  const message = h('p', { class: 'provider-message', role: 'status' });
  const field = createTextField({ label: t('downloads.settings.folder-field'), placeholder: t('downloads.settings.folder-field'), onSubmit: (value) => void choose(value) });
  const editor = h('div', { class: 'tv-fields', hidden: true }, field, h('span', { class: 'setting-hint' }, t('downloads.settings.folder-paste')));
  const quality = h('div', {});
  const keepCount = h('div', {});
  const schedule = h('div', {});

  async function refresh(): Promise<void> {
    const s = await storage().catch(() => null);
    folderHint.textContent = s?.folder ?? '';
    reset.hidden = !s?.custom;
    storageHint.textContent = !s ? '' : s.free === null ? t('downloads.page.storage-used', { used: formatBytes(s.used) }) : t('downloads.page.storage', { used: formatBytes(s.used), free: formatBytes(s.free) });
  }

  async function saved(path: string): Promise<void> {
    editor.hidden = true;
    typePath.setAttribute('aria-expanded', 'false');
    field.value = '';
    message.textContent = '';
    await refresh();
    toast(path.trim() ? t('downloads.settings.folder-saved', { path: folderHint.textContent ?? '' }) : t('downloads.settings.folder-default-saved'));
  }

  async function choose(path: string): Promise<void> {
    try {
      const typed = !editor.hidden;
      await setFolder(path);
      await saved(path);
      // Back to the button that opened the field, or to Change… after a reset (whose button hides).
      (typed ? typePath : change).focus({ preventScroll: true });
    } catch (err) {
      message.textContent = failureText(err);
    }
  }

  // The system's folder dialog; Rust checks the folder as it does a typed one.
  change.addEventListener('click', () => {
    message.textContent = '';
    void pickFolder()
      .then((path) => (path ? saved(path) : undefined))
      .catch((err: unknown) => (message.textContent = failureText(err)));
  });
  typePath.addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    typePath.setAttribute('aria-expanded', String(!editor.hidden));
    message.textContent = '';
    // Showing the field moves focus to it; typing still starts only on Enter or a click.
    if (!editor.hidden) field.focus({ preventScroll: true });
  });
  reset.addEventListener('click', () => void choose(''));

  void settings
    .get(QUALITY_KEY)
    .catch(() => null)
    .then((saved) => {
      quality.replaceChildren(
        row(
          t('downloads.settings.quality'),
          t('downloads.settings.quality-hint'),
          choices(t('downloads.settings.quality'), MAX_QUALITIES.map((q) => [q, QUALITY_LABELS[q]] as const), parseMaxQuality(saved), (v) => void save(QUALITY_KEY, v)),
        ),
      );
    });
  void settings
    .get(KEEP_COUNT_KEY)
    .catch(() => null)
    .then((saved) => {
      keepCount.replaceChildren(
        row(
          t('downloads.settings.keep-next'),
          t('downloads.settings.keep-next-hint'),
          choices(t('downloads.settings.keep-next'), KEEP_COUNTS.map((n) => [n, n.toLocaleString(locale())] as const), parseKeepCount(saved), (v) => void save(KEEP_COUNT_KEY, v)),
        ),
      );
    });
  void Promise.all([settings.get(SPEED_LIMIT_KEY).catch(() => null), settings.get(WINDOW_KEY).catch(() => null)]).then(([limit, hours]) => {
    schedule.replaceChildren(
      row(t('downloads.schedule.speed'), t('downloads.schedule.speed-hint'), choices(t('downloads.schedule.speed'), SPEED_CHOICES, parseSpeedLimit(limit), (v) => void saveSchedule(SPEED_LIMIT_KEY, v))),
      windowRow(hours),
    );
  });
  void refresh();

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'setting-row' },
      h('div', { class: 'setting-text' }, h('span', { class: 'setting-label' }, t('downloads.settings.folder')), h('span', { class: 'setting-hint' }, t('downloads.settings.folder-hint')), folderHint, editor, message),
      h('div', { class: 'tv-source-actions' }, change, typePath, reset),
    ),
    quality,
    keepCount,
    schedule,
    row(t('downloads.settings.storage'), t('downloads.settings.storage-hint'), storageHint),
  );
}
