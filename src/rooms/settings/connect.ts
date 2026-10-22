/**
 * Settings → General → Orbit Connect: the switch, this device's name, "Pair a
 * device" (open to pairing for a while), the Orbits on the network to pair
 * with, the number both devices show while pairing (to be compared), and the
 * paired devices, to control or remove. Rust owns the server, the keys, the
 * secrets and pairing itself (src-tauri/src/connect/); this only shows them.
 */
import { CONNECT_CHANGED, connectCommand, connectState, defaultName, deviceName, refreshConnect, renameDevice, startConnect, stopConnect } from '../../app/connect-state';
import { kindLabel, openRemoteControl } from '../../app/connect-ui';
import { createSwitch } from '../../components/switch';
import { errorText } from '../../components/state-message';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { pairable, type ConnectDevice, type ConnectPrompt, type ConnectStatus } from '../../lib/connect';
import { h } from '../../lib/dom';
import { onSettingsPage } from './dependent-rows';
import { row } from './playback';
import '../../app/connect.css';
import './remote.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function connectSection(): HTMLElement {
  const toggle = createSwitch('', false, (on) => void (on ? act(startConnect) : act(stopConnect)));
  toggle.setAttribute('aria-label', t('connect.settings.enabled'));
  const body = h('div', { class: 'remote-body', hidden: true });
  const section = h('div', { class: 'remote-section connect-section' }, h('h3', { class: 'settings-subheading' }, t('connect.settings.heading')), row(t('connect.settings.enabled'), t('connect.settings.enabled-hint'), toggle), body);
  let expiresAt = 0;
  let countdown: HTMLElement | null = null;
  let ticker: number | undefined;

  function failed(err: unknown): void {
    console.warn('Orbit Connect', err);
    toast(errorText(err, { fallback: 'connect.failed' }));
  }

  function act(run: () => Promise<ConnectStatus>): void {
    void run()
      .catch((err: unknown) => {
        failed(err);
        return connectState();
      })
      .then(show);
  }

  const button = (label: string, focusId: string, run: () => void) => {
    const b = h('button', { class: 'button', 'data-focus-id': focusId }, label);
    b.addEventListener('click', run);
    return b;
  };

  /**
   * A pairing step under way. A second press meanwhile (a double click, a remote's OK pressed twice on slow Wi-Fi)
   * would start a second pairing that replaces the first on the other device, mixing the two: both fail, and the
   * other device shows a number this one never does. So it's ignored until the first is answered.
   */
  let pairing = false;
  function pairStep(run: () => Promise<ConnectStatus>): void {
    if (pairing) return;
    pairing = true;
    act(() => run().finally(() => (pairing = false)));
  }

  /** Starts pairing with `device` (the key it announced is the one pairing is checked against): both then show a number. */
  const pairWith = (device: ConnectDevice) => pairStep(() => connectCommand('connect_pair', { id: device.id, key: device.key }));

  function deviceRow(device: ConnectDevice): HTMLElement {
    const state = device.paired && !device.repair ? h('span', { class: `connect-device-state${device.online ? ' online' : ''}` }, t(device.online ? 'connect.settings.online' : 'connect.settings.offline')) : '';
    const actions: (HTMLElement | string)[] = [];
    let note: HTMLElement | string = '';
    if (device.paired) {
      if (device.repair) {
        note = h('p', { class: 'setting-hint' }, t('connect.settings.repair'));
        if (device.key) actions.push(button(t('connect.settings.pair-again'), `pair-${device.id}`, () => pairWith(device)));
      } else if (device.online) actions.push(button(t('connect.control'), `control-${device.id}`, () => openRemoteControl(device)));
      actions.push(
        button(t('connect.settings.remove'), `remove-${device.id}`, () =>
          act(() => connectCommand('connect_forget', { id: device.id }).then((s) => (toast(t('connect.settings.removed', { device: device.name })), s))),
        ),
      );
    } else if (device.impostor) {
      // Uses a paired device's id with another identity: shown, so it can't pass for it, and never offered.
      note = h('p', { class: 'setting-hint' }, t('connect.settings.impostor'));
    } else {
      actions.push(button(t('connect.settings.pair-with'), `pair-${device.id}-${device.key}`, () => pairWith(device)));
    }
    return h('li', { class: 'connect-device' }, h('p', { class: 'connect-device-name', dir: 'auto' }, t('connect.device-label', { name: device.name, kind: kindLabel(device) })), state, ...actions, note);
  }

  /** The number both devices show while pairing, to be compared by the person. */
  function compare(prompt: ConnectPrompt): HTMLElement {
    const answer = (matches: boolean) => pairStep(() => connectCommand('connect_answer_pairing', { id: prompt.id, matches }));
    const number = h('p', { class: 'remote-code', dir: 'ltr' }, `${prompt.sas.slice(0, 3)} ${prompt.sas.slice(3)}`);
    number.setAttribute('aria-label', prompt.sas.split('').join(' '));
    const device = t('connect.device-label', { name: prompt.name, kind: kindLabel(prompt) });
    return h(
      'div',
      { class: 'remote-pairing-text', role: 'group', 'aria-label': t('connect.pair.heading', { device }) },
      h('p', { class: 'setting-label' }, t('connect.pair.heading', { device })),
      h('p', { class: 'setting-hint' }, t('connect.pair.compare')),
      number,
      prompt.waiting
        ? h('p', { class: 'setting-hint', role: 'status' }, t('connect.pair.waiting', { device: prompt.name }))
        : h('div', { class: 'remote-actions' }, button(t('connect.pair.match'), 'pair-match', () => answer(true)), button(t('connect.pair.no-match'), 'pair-no-match', () => answer(false))),
    );
  }

  function show(status: ConnectStatus): void {
    // Redrawn under the person's focus: it goes back to the same control.
    const focused = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusId : undefined;
    toggle.setAttribute('aria-checked', String(status.running));
    body.hidden = !status.running;
    countdown = null;
    window.clearInterval(ticker);
    ticker = undefined;
    if (!status.running) return body.replaceChildren();

    const name = createTextField({ label: t('connect.settings.name'), placeholder: defaultName(), onSubmit: (value) => act(() => renameDevice(value).then((s) => (toast(t('connect.settings.renamed')), s))) });
    name.dataset.focusId = 'connect-name';
    void deviceName().then((current) => {
      if (name.readOnly) name.value = current;
    });

    let pairing: HTMLElement | string = '';
    if (status.prompt) {
      pairing = compare(status.prompt);
    } else if (status.expiresIn) {
      expiresAt = Date.now() + status.expiresIn * 1000;
      countdown = h('p', { class: 'setting-hint', 'aria-live': 'off' });
      pairing = h('div', { class: 'remote-pairing-text' }, h('p', { class: 'setting-label' }, t('connect.settings.ready')), countdown);
      ticker = window.setInterval(tick, 1000);
      tick();
    } else if (status.locked) {
      pairing = h('p', { class: 'provider-message', role: 'status' }, t('connect.settings.pair-stopped'));
    }

    const paired = status.devices.filter((d) => d.paired);
    const offered = pairable(status);
    body.replaceChildren(
      row(t('connect.settings.name'), t('connect.settings.name-hint'), name),
      h('div', { class: 'remote-actions' }, button(t('connect.settings.pair'), 'connect-pair', () => act(() => connectCommand('connect_open_pairing')))),
      pairing,
      h('h4', { class: 'setting-label' }, t('connect.settings.paired', { count: paired.length, max: status.maxDevices })),
      paired.length ? h('ul', { class: 'connect-devices' }, ...paired.map(deviceRow)) : h('p', { class: 'setting-hint' }, t('connect.settings.none-paired')),
      h('h4', { class: 'setting-label' }, t('connect.settings.nearby')),
      offered.length ? h('ul', { class: 'connect-devices' }, ...offered.map(deviceRow)) : h('p', { class: 'setting-hint' }, t('connect.settings.none-nearby')),
      h('p', { class: 'setting-hint remote-note' }, t('connect.settings.security')),
    );
    if (focused) queueMicrotask(() => (body.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`) ?? body.querySelector<HTMLElement>('[data-focus-id="connect-pair"]'))?.focus({ preventScroll: true }));
  }

  function tick(): void {
    if (!countdown || !onSettingsPage(section)) {
      window.clearInterval(ticker);
      return;
    }
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    countdown.textContent = t('remote.settings.expires', { time: clock(left) });
    if (left === 0) void refreshConnect().then(show).catch(() => {});
  }

  let attached = false;
  const redraw = () => {
    // Kept while General is out of sight (another category or page shown), so it's right when it shows again;
    // once General is drawn again (with a section of its own), this one stops listening.
    if (onSettingsPage(section)) attached = true;
    else if (attached) return document.removeEventListener(CONNECT_CHANGED, redraw);
    // A code being typed isn't swept away by a device going on- or offline.
    if (section.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && !document.activeElement.readOnly) return;
    show(connectState());
  };
  document.addEventListener(CONNECT_CHANGED, redraw);
  // Redraws through `redraw` once the status is in.
  void refreshConnect().catch(() => show(connectState()));
  return section;
}
