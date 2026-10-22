/**
 * Settings → General → Phone remote: the switch, and while it's on, the QR
 * code and 6-digit code to pair a phone with, how many are paired, "Pair a
 * phone" (a fresh code) and "Disconnect all". Rust owns the server, the
 * secrets' lifetimes and the lockout (src-tauri/src/remote/); this only shows them.
 */
import { invoke } from '@tauri-apps/api/core';
import { REMOTE_CHANGED, remoteStatus, startRemote, stopRemote, type RemoteStatus } from '../../app/remote-status';
import { createSwitch } from '../../components/switch';
import { errorText } from '../../components/state-message';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { qrPath } from '../../lib/remote';
import { createTicker } from './countdown-ticker';
import { row } from './playback';
import './remote.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Light modules around the code, as QR readers expect. */
const QUIET = 4;

function qrImage(qr: { size: number; cells: string }): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const full = qr.size + QUIET * 2;
  svg.setAttribute('viewBox', `${-QUIET} ${-QUIET} ${full} ${full}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  const background = document.createElementNS(SVG_NS, 'rect');
  for (const [name, value] of [['x', -QUIET], ['y', -QUIET], ['width', full], ['height', full], ['class', 'remote-qr-light']] as const) background.setAttribute(name, String(value));
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('d', qrPath(qr.size, qr.cells));
  modules.setAttribute('class', 'remote-qr-dark');
  svg.append(background, modules);
  return svg;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The drawn section's refresh and countdown; only the latest drawing is kept up to date. */
let current: { refresh(): void; tick(): void } | null = null;
let listening = false;
/** The countdown's tick, only while a code shows and the latest drawing is seen. */
const ticker = createTicker(() => current?.tick());
/** Whether the latest drawing is on screen (not behind another page or category). */
let onScreen = false;
let watching: IntersectionObserver | null = null;

const startTicker = () => ticker.want(true);
const stopTicker = () => ticker.want(false);
const seenNow = () => ticker.seen(onScreen && !document.hidden);

export function remoteSection(): HTMLElement {
  const toggle = createSwitch('', false, (on) => void (on ? turnOn() : turnOff()));
  toggle.setAttribute('aria-label', t('remote.settings.enabled'));
  const body = h('div', { class: 'remote-body', hidden: true });
  const section = h('div', { class: 'remote-section' }, h('h3', { class: 'settings-subheading' }, t('remote.settings.heading')), row(t('remote.settings.enabled'), t('remote.settings.enabled-hint'), toggle), body);
  /** When the code expires, by this page's clock. */
  let expiresAt = 0;
  let countdown: HTMLElement | null = null;
  let busy = false;

  function failed(err: unknown): void {
    console.warn('Phone remote', err);
    toast(errorText(err, { fallback: 'remote.settings.failed' }));
  }

  async function turnOn(): Promise<void> {
    busy = true;
    try {
      show(await startRemote());
    } catch (err) {
      failed(err);
      toggle.setAttribute('aria-checked', 'false');
    } finally {
      busy = false;
    }
  }

  async function turnOff(): Promise<void> {
    busy = true;
    try {
      show(await stopRemote());
    } catch (err) {
      failed(err);
    } finally {
      busy = false;
    }
  }

  function act(command: string, done?: () => void): void {
    void invoke<RemoteStatus>(command)
      .then((next) => {
        show(next);
        done?.();
      })
      .catch(failed);
  }

  function show(next: RemoteStatus): void {
    // Redrawn under the person's focus: it goes back to the same button (or "Pair a phone", if that one's now disabled).
    const focused = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusId : undefined;
    toggle.setAttribute('aria-checked', String(next.running));
    body.hidden = !next.running;
    countdown = null;
    if (!next.running) {
      body.replaceChildren();
      return stopTicker();
    }
    const pairAgain = h('button', { class: 'button', 'data-focus-id': 'remote-pair' }, t('remote.settings.pair'));
    pairAgain.addEventListener('click', () => act('remote_pair'));
    const disconnect = h('button', { class: 'button', 'data-focus-id': 'remote-disconnect', disabled: next.devices === 0 }, t('remote.settings.disconnect-all'));
    disconnect.addEventListener('click', () => act('remote_disconnect_all', () => toast(t('remote.settings.disconnected'))));
    if (focused) queueMicrotask(() => ((focused === 'remote-disconnect' && !disconnect.disabled ? disconnect : pairAgain) as HTMLElement).focus({ preventScroll: true }));

    let pairing: HTMLElement | string = '';
    if (next.pairUrl && next.code && next.qr && next.address && next.expiresIn) {
      expiresAt = Date.now() + next.expiresIn * 1000;
      countdown = h('p', { class: 'setting-hint', 'aria-live': 'off' });
      const code = h('p', { class: 'remote-code', dir: 'ltr' }, `${next.code.slice(0, 3)} ${next.code.slice(3)}`);
      code.setAttribute('aria-label', next.code.split('').join(' '));
      pairing = h(
        'div',
        { class: 'remote-pairing' },
        h('div', { class: 'remote-qr' }, qrImage(next.qr)),
        h(
          'div',
          { class: 'remote-pairing-text' },
          h('p', { class: 'setting-label' }, t('remote.settings.scan')),
          h('p', { class: 'setting-hint' }, ...withAddress(t('remote.settings.or-type', { address: '\u0000' }), next.address)),
          h('span', { class: 'remote-code-label' }, t('remote.settings.code')),
          code,
          countdown,
        ),
      );
      startTicker();
      tick();
    } else {
      stopTicker();
      // No code showing: locked out, expired, or used by the phone that just paired (which needs no message).
      if (next.locked || next.devices === 0) pairing = h('p', { class: 'provider-message', role: 'status' }, next.locked ? t('remote.settings.locked') : t('remote.settings.expired'));
    }
    body.replaceChildren(
      pairing,
      h('div', { class: 'remote-actions' }, pairAgain, disconnect),
      h('p', { class: 'setting-hint', role: 'status' }, t('remote.settings.devices', { count: next.devices, max: next.maxDevices })),
      h('p', { class: 'setting-hint remote-note' }, t('remote.settings.security')),
    );
  }

  function tick(): void {
    if (!countdown || !section.isConnected) return;
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    countdown.textContent = t('remote.settings.expires', { time: clock(left) });
    if (left === 0) refresh();
  }

  function refresh(): void {
    if (busy) return;
    void remoteStatus()
      .then((next) => {
        if (!busy) show(next);
      })
      .catch((err: unknown) => console.warn('Could not read the phone remote', err));
  }

  current = { refresh, tick };
  onScreen = false;
  seenNow();
  watching?.disconnect();
  watching = new IntersectionObserver((entries) => {
    onScreen = entries.at(-1)?.isIntersecting ?? false;
    seenNow();
  });
  watching.observe(section);
  if (!listening) {
    listening = true;
    document.addEventListener(REMOTE_CHANGED, () => current?.refresh());
    document.addEventListener('visibilitychange', seenNow);
  }
  refresh();
  return section;
}

/** The sentence with the address in place of its marker, the address kept left to right (it's a URL, even in Arabic). */
function withAddress(text: string, address: string): (string | Node)[] {
  const [before = '', after = ''] = text.split('\u0000');
  return [before, h('code', { class: 'remote-address', dir: 'ltr' }, address), after];
}
