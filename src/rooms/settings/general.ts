/**
 * Settings → General: where Orbit opens; the language and what closing the
 * window does; accessibility (scale, motion, effects); new episode alerts; and,
 * under "More general settings", the clock, how the window starts, the phone
 * remote and Orbit Connect, backup and help, profiles and parental controls (a link to the
 * profile picker, where they're managed) and About Orbit.
 */
import { invoke } from '@tauri-apps/api/core';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { FUN_LANGUAGES, isFunLanguage, languageChoice, LANGUAGES, locale, RETURN_TO_KEY, setLanguage, systemLanguage, t, type LanguageChoice, type MessageKey } from '../../i18n';
import { funPrefs } from '../../app/fun-settings';
import { clockChoice, setClock } from '../../lib/clock';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { isAndroid } from '../../lib/platform';
import { createSwitch } from '../../components/switch';
import { toast } from '../../components/toast';
import { alertPrefs, setAlertPrefs, type AlertScope } from '../../library/alerts';
import { airTimesOn, setAirTimesOn } from '../../catalog/air-times';
import { reportError } from '../../app/errors';
import { openProfileSwitcher } from '../profiles/picker';
import { leaveThemeStudio } from '../studio';
import { aboutSection } from './about';
import { backupRows, diagnosticsSection } from './advanced';
import { comfortRows } from './appearance';
import { showDependents } from './dependent-rows';
import { disclosure } from './disclosure';
import { importSection } from './import';
import { connectSection } from './connect';
import { remoteSection } from './remote';
import { openOnboarding } from '../../app/onboarding/flow';
import { chapter, choices, row, save } from './playback';
import { parseWindowMode, type WindowMode } from './window-mode';
import './general.css';

/** Keys the app and the Rust shell read. */
export const GENERAL_SETTINGS = {
  /** 'home' (default) or 'library'. */
  openTo: 'general.open-to',
  /** 'quit' (default) or 'tray'; read by the Rust shell when the window closes. */
  close: 'general.close',
  /** A `WindowMode` ('maximized' by default); read by the Rust shell as it creates the window. */
  window: 'general.window',
} as const;

/** Each language by its own name; System shows which one it means. A dropdown, since the list keeps growing. */
function languageLabel(choice: LanguageChoice): string {
  if (isFunLanguage(choice)) return t(FUN_LANGUAGES.find((l) => l.id === choice)!.name);
  if (choice !== 'system') return LANGUAGES.find((l) => l.id === choice)!.name;
  return t('settings.general.language-system-is', { name: LANGUAGES.find((l) => l.id === systemLanguage())!.name });
}

function languagePicker(): HTMLElement {
  // Drawn like the page's other values (compact.ts): what's chosen, and a chevron that opens the list.
  const button = h('button', { class: 'setting-value', 'aria-haspopup': 'menu', 'aria-label': t('settings.general.language') }, h('span', { class: 'setting-value-text' }, languageLabel(languageChoice())), icon('chevronRight'));
  button.addEventListener('click', () => {
    const options: { choice: LanguageChoice; group?: string }[] = [
      ...(['system', ...LANGUAGES.map((l) => l.id)] as LanguageChoice[]).map((choice) => ({ choice })),
      // The joke languages only with Fun languages on (Settings → Appearance), in a group of their own.
      ...(funPrefs().languages ? FUN_LANGUAGES.map((l) => ({ choice: l.id, group: t('funlangs.group') })) : []),
    ];
    openMenuFrom(
      button,
      options.map(({ choice, group }) => ({
        label: languageLabel(choice),
        ...(group ? { group } : {}),
        checked: () => choice === languageChoice(),
        // Every page is drawn in the old language; start over in the new one.
        action: () => {
          if (choice === languageChoice()) return;
          // Unsaved Theme Studio edits are asked about first: the reload would drop them.
          void leaveThemeStudio()
            .then((left) => {
              if (!left) return;
              return setLanguage(choice)
                .then(() => {
                  // Come back here, not to Home.
                  try {
                    sessionStorage.setItem(RETURN_TO_KEY, 'settings-general');
                  } catch {
                    // Without storage it opens as usual.
                  }
                  return invoke('player_stop').catch(() => {});
                })
                .then(() => location.reload());
            })
            .catch(failed);
        },
      })),
      'end',
    );
  });
  return button;
}

/**
 * The page in one column: where Orbit opens (two pictures), then everyday,
 * accessibility and notification settings, each a short group; the rest of
 * General waits under "More general settings".
 */
export function generalPanel(): HTMLElement {
  const panel = h('div', { class: 'general-page' });
  void Promise.all([settings.get(GENERAL_SETTINGS.openTo).catch(() => null), settings.get(GENERAL_SETTINGS.close).catch(() => null), settings.get(GENERAL_SETTINGS.window).catch(() => null)]).then(([openTo, close, windowMode]) => {
    // Android has no window to size or to close to the tray.
    const [windowRow, closeRow] = isAndroid ? [] : windowRows(windowMode, close);
    const alerts = alertsRows();
    panel.replaceChildren(
      openToSection(openTo === 'library' ? 'library' : 'home'),
      group(
        'settingsgeneral.everyday',
        row(
          t('settings.general.language'),
          t(isAndroid ? 'settings.general.language-hint-android' : 'settings.general.language-hint'),
          languagePicker(),
        ),
        ...(closeRow ? [closeRow] : []),
      ),
      group('settingsgeneral.accessibility', ...comfortRows()),
      h('section', { class: 'settings-group alerts-settings' }, chapter('settings.section.notifications'), ...alerts.main, disclosure('notifications', t('settingsgeneral.more-notifications'), alerts.more)),
      disclosure('general', t('settingsgeneral.more-general'), [
        clockRow(),
        ...(windowRow ? [windowRow] : []),
        remoteSection(),
        connectSection(),
        h('h3', { class: 'settings-subheading backup-section' }, t('settings.section.backup')),
        ...backupRows(),
        diagnosticsSection(),
        setupAgainRow(),
        // After the help rows: it starts with its own Import heading.
        importSection(),
        ...profilesSection(),
        aboutSection(),
      ]),
    );
  });
  return panel;
}

/** A group of rows under its heading. */
const group = (heading: MessageKey, ...rows: HTMLElement[]): HTMLElement => h('section', { class: 'settings-group' }, chapter(heading), ...rows);

/**
 * "Open to": a small picture of each page to pick from, the chosen one
 * marked with a check. Choosing is pressing (aria-pressed), so focus and
 * the choice stay apart: arrows move focus, Enter picks.
 */
function openToSection(current: 'home' | 'library'): HTMLElement {
  const cards = (['home', 'library'] as const).map((page) => {
    const card = h(
      'button',
      { class: 'open-to-card', 'data-page': page, 'aria-pressed': String(page === current) },
      openToPicture(page),
      h('span', { class: 'open-to-name' }, h('span', {}, t(page === 'home' ? 'settings.general.open-to-home' : 'settings.general.open-to-library')), h('span', { class: 'open-to-check', 'aria-hidden': 'true' }, icon('check'))),
    );
    card.addEventListener('click', () => {
      if (card.getAttribute('aria-pressed') === 'true') return;
      for (const c of cards) c.setAttribute('aria-pressed', String(c === card));
      void save(GENERAL_SETTINGS.openTo, page);
    });
    return card;
  });
  return h(
    'section',
    { class: 'settings-group open-to-section' },
    chapter('settings.general.open-to'),
    h('p', { class: 'settings-intro', id: 'open-to-hint' }, t('settings.general.open-to-hint')),
    h('div', { class: 'open-to-cards', role: 'group', 'aria-label': t('settings.general.open-to'), 'aria-describedby': 'open-to-hint' }, ...cards),
  );
}

/**
 * A capture-style sketch of the page, drawn in the theme's own colours (so
 * it follows every Look) rather than a screenshot: Home's banner over a row
 * of cards, or My Library's heading, filters and grid of posters.
 */
function openToPicture(page: 'home' | 'library'): HTMLElement {
  const blocks = (n: number, cls: string) => Array.from({ length: n }, () => h('span', { class: cls }));
  const bar = h('span', { class: 'open-to-bar' }, h('span', { class: 'open-to-logo' }), ...blocks(4, 'open-to-tab'));
  const body =
    page === 'home'
      ? [h('span', { class: 'open-to-hero' }, h('span', { class: 'open-to-line wide' }), h('span', { class: 'open-to-line' }), h('span', { class: 'open-to-pill' })), h('span', { class: 'open-to-row' }, ...blocks(5, 'open-to-tile'))]
      : [h('span', { class: 'open-to-line title' }), h('span', { class: 'open-to-chips' }, ...blocks(4, 'open-to-chip')), h('span', { class: 'open-to-grid' }, ...blocks(12, 'open-to-poster'))];
  // Not a bare `home` class: `#app:has(.home)` means Home is showing (it floats the title bar).
  return h('span', { class: `open-to-picture open-to-${page}`, 'aria-hidden': 'true' }, bar, ...body);
}

/** Clock: as the language and region write times, or always 12-hour or 24-hour (lib/clock.ts). */
function clockRow(): HTMLElement {
  // An example time in each style, so the choice says what it does.
  const sample = new Date(2000, 0, 1, 21, 30);
  // Isolated, so in Hebrew or Arabic "9:30 PM" isn't reordered by the text around it.
  const example = (hourCycle: 'h12' | 'h23') => `\u2068${new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', hourCycle }).format(sample)}\u2069`;
  return row(
    t('pages.clock.label'),
    t('pages.clock.hint'),
    choices(
      t('pages.clock.label'),
      [
        ['system', t('settings.common.system')],
        ['12', t('pages.clock.twelve', { example: example('h12') })],
        ['24', t('pages.clock.twenty-four', { example: example('h23') })],
      ] as const,
      clockChoice(),
      (clock) => void setClock(clock).catch(failed),
    ),
  );
}

/** How the window opens, and what closing it does (read by the Rust shell). */
function windowRows(windowMode: unknown, close: unknown): HTMLElement[] {
  return [
    row(
      t('settings.general.window'),
      t('settings.general.window-hint'),
      choices<WindowMode>(
        t('settings.general.window'),
        [
          ['normal', t('settings.general.window-normal')],
          ['maximized', t('settings.general.window-maximized')],
          ['fullscreen', t('settings.general.window-fullscreen')],
        ],
        parseWindowMode(windowMode),
        (v) => save(GENERAL_SETTINGS.window, v),
      ),
    ),
    row(
      t('settings.general.close'),
      t('settings.general.close-hint'),
      choices(
        t('settings.general.close'),
        [
          ['quit', t('settings.general.close-quit')],
          ['tray', t('settings.general.close-tray')],
        ] as const,
        close === 'tray' ? 'tray' : 'quit',
        (v) => save(GENERAL_SETTINGS.close, v),
      ),
    ),
  ];
}

/** First-run setup again, over Settings; it changes only what its steps are used for. */
function setupAgainRow(): HTMLElement {
  const run = h('button', { class: 'button' }, t('onboard.settings.again-button'));
  run.addEventListener('click', () => openOnboarding('again'));
  return row(t('onboard.settings.again'), t('onboard.settings.again-hint'), run);
}

/** Profiles, PINs and content limits live in the profile picker; this opens it on managing them. */
function profilesSection(): HTMLElement[] {
  const manage = h('button', { class: 'button' }, t('titles.profiles.manage'));
  manage.addEventListener('click', () => void openProfileSwitcher(true).catch((err: unknown) => reportError('Could not open the profile switcher', err)));
  return [h('h3', { class: 'settings-subheading' }, t('settings.section.profiles')), row(t('settings.general.profiles'), t('settings.general.profiles-hint'), manage)];
}

function failed(err: unknown): void {
  console.error('Could not save setting', err);
  toast(t('settings.common.save-failed'));
}

/**
 * New episode alerts: the title bar's bell, then (only while it's on) system
 * notifications and which shows count; `more` (which shows, exact air times)
 * goes under "More notification options".
 */
function alertsRows(): { main: HTMLElement[]; more: HTMLElement[] } {
  const prefs = alertPrefs();
  const enabled = createSwitch('', prefs.enabled, (on) => {
    showDependents(enabledRow, followUps, on);
    void setAlertPrefs({ enabled: on }).catch(failed);
  });
  enabled.setAttribute('aria-label', t('alerts.settings.enabled'));
  const toasts = createSwitch('', prefs.toasts, (on) => void setAlertPrefs({ toasts: on }).catch(failed));
  toasts.setAttribute('aria-label', t('alerts.settings.toasts'));
  const scope = choices<AlertScope>(
    t('alerts.settings.scope'),
    [
      ['watching', t('alerts.settings.scope-watching')],
      ['library', t('alerts.settings.scope-library')],
    ],
    prefs.scope,
    (value) => void setAlertPrefs({ scope: value }).catch(failed),
  );
  const enabledRow = row(t('alerts.settings.enabled'), t('alerts.settings.enabled-hint'), enabled);
  const toastsRow = row(t('alerts.settings.toasts'), t('alerts.settings.toasts-hint'), toasts);
  const scopeRow = row(t('alerts.settings.scope'), t('alerts.settings.scope-hint'), scope);
  const followUps = [toastsRow, scopeRow];
  showDependents(enabledRow, followUps, prefs.enabled);
  // Exact air times (catalog/air-times.ts): Release Radar and autoplay use them too, so the row stays when alerts are off.
  const airTimes = createSwitch('', airTimesOn(), (on) => void setAirTimesOn(on).catch(failed));
  airTimes.setAttribute('aria-label', t('movix.air.setting'));
  const airRow = row(t('movix.air.setting'), t('movix.air.setting-hint'), airTimes);
  return { main: [enabledRow, toastsRow], more: [scopeRow, airRow] };
}
