/** Settings → General → About Orbit: the mark, the version, who made it and its licence, and updates. */
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openInBrowser } from '../../lib/browser';
import { createSwitch } from '../../components/switch';
import { brandMark } from '../../app/titlebar';
import { AUTO_CHECK_KEY, AUTO_UPDATE_KEY, checkForUpdates, installUpdate, UPDATE_FAILED, UPDATE_READY, updateStatus, type CheckOutcome } from '../../app/updates';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { isAndroid } from '../../lib/platform';
import { whileOnPage } from './dependent-rows';
import { row, save } from './playback';

/**
 * Where the source code lives (About shows it, as the GPL asks). It must stay on a host
 * Rust's `open_external` allows (browser.rs EXTERNAL_HOSTS). Typed with `as` so a build
 * without a public repository can set it to null.
 */
const SOURCE_URL = 'https://github.com/fusnk/orbit' as string | null;
const AUTHOR = 'fusnk';
const LICENCE = 'GPL-3.0-or-later';
/** Names Orbit shows or works with, listed in the legal note as their owners'. */
const NAMES = ['Stremio', 'Cinemeta', 'OpenSubtitles', 'Real-Debrid', 'TorBox', 'TMDB', 'IMDb', 'TVmaze', 'Letterboxd', 'Jellyfin', 'Plex', 'Discord', 'Trakt', 'AniList', 'MyAnimeList', 'Kitsu', 'AniSkip', 'TheIntroDB', 'RPDB', 'JustWatch', 'TheTVDB', 'YouTube', 'OpenAI', 'Google Gemini', 'Anthropic', 'Netflix', 'Disney+'];

const SVG_NS = 'http://www.w3.org/2000/svg';

export function aboutSection(): HTMLElement {
  // Room for the moon's whole path around the ring (it sits 136 from the centre, radius 28).
  const mark = brandMark('about-mark', '-170 -170 340 340');
  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('r', '136');
  track.setAttribute('class', 'about-track');
  mark.prepend(track);

  const version = h('span', { class: 'about-version', hidden: true });
  void getVersion()
    .then((v) => {
      version.textContent = t('settingshome.about.version', { version: v });
      version.hidden = false;
    })
    .catch((err: unknown) => console.warn('Could not read the app version', err));

  const facts = h('div', { class: 'about-facts' }, h('span', { class: 'about-name' }, 'Orbit'), version, h('span', { class: 'about-line' }, t('settingshome.about.made-by', { name: AUTHOR })), h('span', { class: 'about-line' }, t('settingshome.about.licence', { licence: LICENCE })));
  const links = h('div', { class: 'about-links' });
  if (SOURCE_URL) {
    const url = SOURCE_URL;
    const source = h('button', { class: 'button' }, t('settingshome.about.source'));
    source.addEventListener('click', () => void openInBrowser(url).catch((err: unknown) => console.warn('Could not open the source code page', err)));
    links.append(source);
  }
  // The notices file is a desktop resource (tauri.conf.json); Android has no text viewer to open it in.
  if (!isAndroid) {
    const licences = h('button', { class: 'button' }, t('settingshome.about.licences'));
    licences.addEventListener('click', () => void invoke('licences_open').catch((err: unknown) => console.warn('Could not open the licences', err)));
    links.append(licences);
  }
  if (links.childElementCount) facts.append(links);

  const legal = h(
    'div',
    { class: 'about-legal' },
    h('h4', { class: 'about-legal-heading' }, t('settingshome.about.legal-heading')),
    h('p', {}, t('settingshome.about.legal-independent', { names: NAMES.join(', ') })),
    h('p', {}, t('settingshome.about.legal-content')),
    // TMDB's terms ask apps that use its API for this notice. As text: Orbit has no copy of TMDB's logo to show under its licence.
    h('p', { class: 'about-tmdb' }, t('pages.about.tmdb')),
    // TVmaze's data is CC BY-SA 4.0, which asks for credit wherever it's shown (exact air times in Release Radar).
    h('p', { class: 'about-tvmaze' }, t('pages.about.tvmaze')),
  );

  return h('section', { class: 'about-section', 'aria-labelledby': 'about-heading' }, h('h3', { class: 'settings-subheading', id: 'about-heading' }, t('settingshome.about.heading')), h('div', { class: 'about-card' }, mark, facts), ...updateRows(), legal);
}

/**
 * "Check for updates" (or "Restart to update" once one is downloaded), with
 * what the last check found as its hint; and "Update automatically". In
 * builds without updates, just a line saying so.
 */
function updateRows(): HTMLElement[] {
  const button = h('button', { class: 'button' }, t('settingshome.updates.check'));
  const checkRow = row(t('settingshome.updates.label'), t('settingshome.updates.idle'), button);
  const hint = checkRow.querySelector<HTMLElement>('.setting-hint')!;
  hint.setAttribute('aria-live', 'polite');
  // The line under Check for updates, until a check says more: when Orbit checks, and whether it asks
  // before installing or installs on quit (Update automatically).
  let checkOn = true;
  let autoOn = false;
  const IDLE = ['settingshome.updates.idle', 'settingshome.updates.idle-manual', 'settingshome.updates.idle-auto', 'settingshome.updates.idle-manual-auto'] as const;
  const idleText = () => t(IDLE[(checkOn ? 0 : 1) + (autoOn ? 2 : 0)]!);
  const setIdle = (change: () => void) => {
    const idle = IDLE.some((key) => hint.textContent === t(key));
    change();
    if (idle) hint.textContent = idleText();
  };
  // On unless turned off (Rust reads it the same way), so existing installs keep checking.
  const checkAuto = createSwitch('', true, (on) => {
    setIdle(() => (checkOn = on));
    void save(AUTO_CHECK_KEY, on);
  });
  checkAuto.setAttribute('aria-label', t('settingshome.updates.check-auto'));
  const checkAutoRow = row(t('settingshome.updates.check-auto'), t('settingshome.updates.check-auto-hint'), checkAuto);
  const auto = createSwitch('', false, (on) => {
    setIdle(() => (autoOn = on));
    void save(AUTO_UPDATE_KEY, on);
  });
  auto.setAttribute('aria-label', t('settingshome.updates.auto'));
  const autoRow = row(t('settingshome.updates.auto'), t('settingshome.updates.auto-hint'), auto);
  checkRow.hidden = checkAutoRow.hidden = autoRow.hidden = true;

  let ready: string | null = null;
  const showReady = (version: string) => {
    ready = version;
    hint.textContent = t('settingshome.updates.ready', { version });
    button.textContent = t('settingshome.updates.restart');
    button.disabled = false;
  };
  const show = (outcome: CheckOutcome) => {
    if (outcome.state === 'ready') return showReady(outcome.version);
    // Asking again while a download runs just says so ("busy"), so the button stays usable.
    button.disabled = false;
    hint.textContent =
      outcome.state === 'downloading' ? t('settingshome.updates.downloading', { version: outcome.version })
      : outcome.state === 'busy' ? t('settingshome.updates.checking')
      : outcome.state === 'off' ? t('settingshome.updates.off')
      : t('settingshome.updates.up-to-date');
  };

  button.addEventListener('click', () => {
    if (ready) {
      button.disabled = true;
      void installUpdate().then((installed) => {
        button.disabled = false;
        if (installed) return;
        // "Restart to update" would now ask for an update Rust no longer holds.
        ready = null;
        button.textContent = t('settingshome.updates.check');
        hint.textContent = t('settingshome.updates.install-failed');
      });
      return;
    }
    button.disabled = true;
    hint.textContent = t('settingshome.updates.checking');
    void checkForUpdates()
      .then(show)
      .catch(() => {
        // Offline or GitHub unreachable: Rust has logged why.
        hint.textContent = t('settingshome.updates.failed');
        button.disabled = false;
      });
  });
  // A download finishing while this page is open.
  // Not `isConnected`: the page is detached while another category or room shows, and kept.
  whileOnPage(button, UPDATE_READY, (event) => showReady((event as CustomEvent<string>).detail));
  // A download failing while this page is open (otherwise "Downloading…" would stay up).
  whileOnPage(button, UPDATE_FAILED, (event) => {
    if (ready) return;
    hint.textContent = t('settingshome.updates.download-failed', { version: (event as CustomEvent<string>).detail });
    button.disabled = false;
  });

  void Promise.all([updateStatus(), settings.get(AUTO_UPDATE_KEY), settings.get(AUTO_CHECK_KEY)])
    .then(([status, autoSaved, checkSaved]) => {
      if (!status.enabled) {
        checkRow.hidden = false;
        button.hidden = true;
        hint.textContent = t('settingshome.updates.off');
        return;
      }
      checkRow.hidden = checkAutoRow.hidden = autoRow.hidden = false;
      setIdle(() => {
        checkOn = checkSaved !== false;
        autoOn = autoSaved === true;
      });
      checkAuto.setAttribute('aria-checked', String(checkOn));
      auto.setAttribute('aria-checked', String(autoOn));
      if (status.ready) showReady(status.ready);
      else if (status.busy) show({ state: 'busy' });
    })
    .catch((err: unknown) => console.warn('Could not read the update state', err));

  return [checkRow, checkAutoRow, autoRow];
}
