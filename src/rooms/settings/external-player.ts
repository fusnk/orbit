/**
 * Settings → Player → External player: which program "Open in external
 * player" hands sources to, and whether Play always does. Rust looks for the
 * presets in their usual install folders; a custom program is picked in the
 * system's file dialog, opened and checked by Rust (see src-tauri/src/external.rs).
 */
import { invoke } from '@tauri-apps/api/core';
import { createSwitch } from '../../components/switch';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { EXTERNAL_ALWAYS_KEY, EXTERNAL_KEY, EXTERNAL_KINDS, externalChanged, parseExternal, type ExternalChoice, type ExternalKind } from '../player/external';
import { choices, pressChoice, row, save } from './playback';
import './external-player.css';

const NAMES: Record<ExternalKind, string> = {
  none: t('local.external.none'),
  vlc: 'VLC',
  mpv: 'mpv',
  'mpc-hc': 'MPC-HC',
  'mpc-be': 'MPC-BE',
  potplayer: 'PotPlayer',
  custom: t('local.external.custom'),
};

export function externalPlayerSection(): HTMLElement {
  const body = h('div', {});
  const status = h('p', { class: 'provider-message', role: 'status' });
  const customRow = h('div', {});
  const alwaysRow = h('div', {});
  let current: ExternalChoice = { kind: 'none' };
  /** Shows the saved choice again (Custom picked, then its file dialog cancelled or the program refused). */
  let revert = (): void => {};

  async function check(kind: ExternalKind): Promise<boolean> {
    if (kind === 'none') {
      status.textContent = '';
      return false;
    }
    try {
      // A custom player is checked as saved in Rust; the page never names a path.
      const found = await invoke<string>('external_player_find', { kind });
      status.textContent = t('local.external.found', { path: found });
      return true;
    } catch {
      status.textContent = kind === 'custom' ? t('local.external.custom-invalid') : t('local.external.not-found');
      return false;
    }
  }

  function chosen(next: ExternalChoice): void {
    current = next;
    externalChanged({ choice: next });
    alwaysRow.hidden = next.kind === 'none';
  }

  /** A preset, or none. A custom program is saved by Rust from its own file dialog (`pick`). */
  function setChoice(next: ExternalChoice): void {
    chosen(next);
    void invoke('external_player_set', { kind: next.kind === 'none' ? null : next.kind }).catch((err: unknown) => {
      console.warn('Could not save the external player', err);
      status.textContent = t('local.external.not-found');
    });
  }

  async function pick(): Promise<void> {
    try {
      const path = await invoke<string | null>('external_player_pick');
      if (path === null) {
        revert();
        void check(current.kind);
        return;
      }
      chosen({ kind: 'custom', path });
      status.textContent = t('local.external.found', { path });
    } catch (err) {
      console.warn('Could not use that program as the external player', err);
      revert();
      status.textContent = t('local.external.custom-invalid');
    }
  }

  function showCustom(): void {
    const button = h('button', { class: 'button primary' }, t('local.external.choose'));
    button.addEventListener('click', () => void pick());
    customRow.replaceChildren(row(t('local.external.custom-path'), t('local.external.custom-path-hint'), button));
  }

  void Promise.all([settings.get(EXTERNAL_KEY).catch(() => null), settings.get(EXTERNAL_ALWAYS_KEY).catch(() => null)]).then(([saved, alwaysSaved]) => {
    current = parseExternal(saved);
    externalChanged({ choice: current, always: alwaysSaved === true });
    const picker = choices(
      t('local.external.player'),
      EXTERNAL_KINDS.map((kind) => [kind, NAMES[kind]] as const),
      current.kind,
      (kind) => {
        if (kind === 'custom') {
          // Saved once a program that works is picked.
          status.textContent = '';
          showCustom();
          return;
        }
        customRow.replaceChildren();
        setChoice({ kind });
        void check(kind);
      },
    );
    const options = EXTERNAL_KINDS.map((kind) => [kind, NAMES[kind]] as const);
    revert = () => {
      pressChoice(picker, options, current.kind);
      if (current.kind !== 'custom') customRow.replaceChildren();
    };
    const always = createSwitch('', alwaysSaved === true, (on) => {
      externalChanged({ always: on });
      void save(EXTERNAL_ALWAYS_KEY, on);
    });
    always.setAttribute('aria-label', t('local.external.always'));
    alwaysRow.replaceChildren(row(t('local.external.always'), t('local.external.always-hint'), always));
    alwaysRow.hidden = current.kind === 'none';
    if (current.kind === 'custom') showCustom();
    body.replaceChildren(row(t('local.external.player'), t('local.external.player-hint'), picker), status, customRow, alwaysRow);
    void check(current.kind);
  });

  return h('div', { class: 'external-player-section' }, h('h3', { class: 'settings-subheading' }, t('local.external.heading')), body);
}
