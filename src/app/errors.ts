/**
 * What happens when something goes wrong that nothing else caught: Orbit
 * stays usable. An uncaught error or rejection shows a short toast (at most
 * one every few seconds) and goes to the log file (Settings → General → Backup & help →
 * "Open log folder"); a page that fails to draw shows a message with "Try
 * again" in its place; and if startup itself fails, a screen to restart
 * replaces the blank window.
 *
 * Reports are capped here and redacted in Rust (`diagnostics.rs`) before
 * anything is written, since error text can quote addresses or titles.
 */
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { h } from '../lib/dom';

const MAX_REPORT_CHARS = 2000;
const STACK_LINES = 6;
const TOAST_GAP_MS = 8000;
let lastToast = 0;

/** An error as one short text: its name, message and the top of its stack. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = (err.stack ?? '').split('\n').slice(1, STACK_LINES + 1).map((line) => line.trim());
    return [`${err.name}: ${err.message}`, ...stack].join(' | ').slice(0, MAX_REPORT_CHARS);
  }
  try {
    return (typeof err === 'string' ? err : JSON.stringify(err) ?? String(err)).slice(0, MAX_REPORT_CHARS);
  } catch {
    return String(err).slice(0, MAX_REPORT_CHARS);
  }
}

/** Logs `err` to the console and the log file. */
export function reportError(context: string, err: unknown, level: 'warn' | 'error' = 'error'): void {
  console[level](context, err);
  const message = `${context}: ${describeError(err)}`.slice(0, MAX_REPORT_CHARS);
  void invoke('diagnostics_log', { level, message }).catch(() => {});
}

/** Chromium's harmless notice when a ResizeObserver callback changes layout. */
const isBenign = (message: string) => message.includes('ResizeObserver loop');

function notify(): void {
  // Startup didn't get as far as drawing anything: offer a restart instead of a blank window.
  const root = document.getElementById('app');
  if (root && !root.childElementCount) return void root.replaceChildren(startupError());
  if (Date.now() - lastToast < TOAST_GAP_MS) return;
  lastToast = Date.now();
  toast(t('settings.errors.toast'));
}

/** Catches what nothing else did; call before anything else runs. */
export function installErrorBoundary(): void {
  window.addEventListener('error', (event) => {
    if (isBenign(event.message ?? '')) return;
    reportError('Uncaught error', event.error ?? event.message);
    notify();
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError('Unhandled rejection', event.reason);
    notify();
  });
}

/**
 * Copies Rust's diagnostics report (redacted there: no addresses, keys or
 * titles) for a bug report, and says how it went in `status`. Where the
 * clipboard isn't allowed, the text is shown to copy by hand.
 */
export function copyDiagnostics(status: HTMLElement, errorText: (err: unknown) => string = describeError): void {
  status.replaceChildren();
  void invoke<string>('diagnostics_report')
    .then(async (report) => {
      try {
        await navigator.clipboard.writeText(report);
        status.textContent = t('settings.advanced.copied');
      } catch {
        const text = h('textarea', { class: 'diagnostics-text', readonly: true, rows: '10', 'aria-label': t('settings.advanced.copy-diagnostics') });
        text.value = report;
        status.replaceChildren(t('settings.advanced.copy-failed'), text);
        text.select();
      }
    })
    .catch((err: unknown) => (status.textContent = errorText(err)));
}

/** "Copy diagnostics" beside an error view's Try again, so a bug report needn't hunt for it in Settings. */
function diagnosticsButton(): { copy: HTMLElement; status: HTMLElement } {
  const status = h('p', { class: 'muted page-error-status', role: 'status' });
  const copy = h('button', { class: 'button' }, t('settings.advanced.copy-diagnostics'));
  copy.addEventListener('click', () => copyDiagnostics(status));
  return { copy, status };
}

/** In place of a page that failed to draw. */
export function pageError(retry: () => void): HTMLElement {
  const button = h('button', { class: 'button primary' }, t('browse.search.retry'));
  button.addEventListener('click', retry);
  const { copy, status } = diagnosticsButton();
  return h('div', { class: 'page-error', role: 'alert' }, h('span', { class: 'home-message-title' }, t('settings.errors.page')), h('p', { class: 'muted' }, t('settings.errors.page-detail')), h('div', { class: 'hero-actions' }, button, copy), status);
}

/** When Orbit couldn't start: what happened, and a way to try again. */
export function startupError(): HTMLElement {
  const button = h('button', { class: 'button primary' }, t('browse.search.retry'));
  button.addEventListener('click', () => location.reload());
  const { copy, status } = diagnosticsButton();
  return h('div', { class: 'page-error startup-error', role: 'alert' }, h('span', { class: 'home-message-title' }, t('settings.errors.startup')), h('p', { class: 'muted' }, t('settings.errors.startup-detail')), h('div', { class: 'hero-actions' }, button, copy), status);
}
