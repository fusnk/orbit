/**
 * First-run setup: four short steps over the app (language, a Look, where
 * content comes from, optional keys), every one skippable, with Back.
 * Each step is the real control from Settings, not a copy, so whatever is
 * done here is done for good and nothing changes unless a step is actually
 * used. It's a modal layer: the app behind is inert, Back (Esc, Backspace,
 * the mouse's back button) goes back a step, and focus stays inside.
 *
 * `first` is the automatic run on a new install: ending it (finished or
 * skipped) records that, and starts Home's "Getting started" card.
 * `again` (Settings → General) records nothing.
 */
import { invoke } from '@tauri-apps/api/core';
import { openInBrowser } from '../../lib/browser';
import { icon, type IconName } from '../../components/icons';
import { pushLayer } from '../../components/layers';
import { languageChoice, LANGUAGES, setLanguage, systemLanguage, t, type LanguageChoice, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { debridSection } from '../../rooms/settings/debrid';
import { tmdbRow } from '../../rooms/settings/integrations';
import { saveTypedKeys } from '../../rooms/settings/typed-keys';
import { jellyfinSection } from '../../rooms/settings/jellyfin';
import { looksSection } from '../../rooms/settings/looks';
import { plexSection } from '../../rooms/settings/plex';
import { stremioSection } from '../../rooms/settings/stremio';
import { createInstallPanel } from '../../rooms/addons/install';
import { onBack } from '../back';
import { forgetFocus } from '../spatial';
import { reportError } from '../errors';
import { brandMark } from '../titlebar';
import { setSetupOpen } from './gate';
import { closesAfterSaving, shouldOnboard } from './rules';
import { markOnboarded, nameFirstProfile, ONBOARDING_CLOSED, rememberResume, setupSignals, startChecklist, takeResume, type SetupMode } from './state';
import './onboarding.css';


const STEPS = ['welcome', 'look', 'stuff', 'extras'] as const;
type Step = (typeof STEPS)[number];
type Source = 'stremio' | 'server' | 'addon';

/** Where TMDB hands out keys (an account is free). */
const TMDB_KEY_PAGE = 'https://www.themoviedb.org/settings/api';

let showing = false;

/**
 * Startup: reopens setup after its own language change reloaded the window,
 * else opens it on a new install only (rules.ts).
 */
export async function startOnboardingIfNew(): Promise<void> {
  const resume = takeResume();
  // A new install's first profile takes its name in the person's language (again after a language picked in setup).
  const named = () => nameFirstProfile().catch((err: unknown) => reportError('Could not name the first profile', err, 'warn'));
  if (resume) {
    if (resume === 'first') await named();
    return openOnboarding(resume);
  }
  if (!shouldOnboard(await setupSignals())) return;
  await named();
  openOnboarding('first');
}

export function openOnboarding(mode: SetupMode): void {
  if (showing) return;
  showing = true;
  const returnFocus = document.activeElement;

  let step: Step = 'welcome';
  /** On "Bring your stuff": the way in that's open, if any. */
  let source: Source | null = null;
  let closed = false;
  /** The way in last opened, to return focus to its choice. */
  let previous: Source | null = null;
  /**
   * "Optional extras", built once: a key typed there and left by Back is still there on the way
   * back, and Skip from another step saves it, rather than a redraw dropping it unseen.
   */
  let extras: HTMLElement[] | null = null;

  const title = h('h1', { class: 'onboard-title', id: 'onboard-title', tabindex: '-1' });
  const body = h('div', { class: 'onboard-body' });
  const count = h('span', { class: 'onboard-count' });
  const progress = h('div', { class: 'onboard-progress', 'aria-hidden': 'true' }, ...STEPS.map(() => h('span', {})));
  const skipAll = h('button', { class: 'button onboard-skip' }, t('onboard.skip-all'));
  const back = h('button', { class: 'button large' }, icon('back'), t('onboard.back'));
  const next = h('button', { class: 'button large primary' });
  const scroller = h('div', { class: 'onboard-scroll' }, h('div', { class: 'onboard-column' }, brandMark('onboard-mark'), title, body));
  const overlay = h(
    'div',
    { class: 'onboard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboard-title' },
    // The window has no frame of its own: this bar still moves it.
    h('header', { class: 'onboard-top', 'data-tauri-drag-region': true }, progress, count, skipAll),
    scroller,
    h('footer', { class: 'onboard-foot' }, back, next),
  );

  skipAll.addEventListener('click', () => void done(true));
  back.addEventListener('click', goBack);
  next.addEventListener('click', () => {
    const at = STEPS.indexOf(step);
    if (at === STEPS.length - 1) void done(false);
    else show(STEPS[at + 1]!);
  });

  function goBack(): void {
    if (step === 'stuff' && source) return showSource(null);
    const at = STEPS.indexOf(step);
    if (at > 0) show(STEPS[at - 1]!);
  }

  function show(to: Step): void {
    step = to;
    source = null;
    const at = STEPS.indexOf(to);
    count.textContent = t('onboard.progress', { step: at + 1, total: STEPS.length });
    [...progress.children].forEach((bar, i) => bar.classList.toggle('reached', i <= at));
    back.hidden = at === 0;
    next.textContent = to === 'welcome' ? t('onboard.welcome.start') : to === 'extras' ? t('onboard.finish') : t('onboard.continue');
    overlay.dataset.step = to;
    title.textContent = t(TITLES[to]);
    body.replaceChildren(...(to === 'extras' ? (extras ??= BUILD.extras()) : BUILD[to]()));
    replay(body);
    scroller.scrollTo({ top: 0 });
    // The welcome's way on is the button; later steps start at their heading, where arrows lead into the step.
    (to === 'welcome' ? next : title).focus({ preventScroll: true });
  }

  /** "Bring your stuff": the choices, or the one picked, with the real Settings section inline. */
  function showSource(to: Source | null): void {
    source = to;
    if (!to) {
      body.replaceChildren(...BUILD.stuff());
      replay(body);
      body.querySelector<HTMLElement>(`[data-source="${previous}"]`)?.focus({ preventScroll: true });
      return;
    }
    previous = to;
    const others = h('button', { class: 'button onboard-others' }, icon('back'), t('onboard.stuff.choices'));
    others.addEventListener('click', () => showSource(null));
    body.replaceChildren(others, h('div', { class: 'onboard-section', 'data-source': to }, ...SOURCES[to]()));
    replay(body);
    others.focus({ preventScroll: true });
  }

  const TITLES: Record<Step, MessageKey> = {
    welcome: 'onboard.welcome.title',
    look: 'onboard.look.title',
    stuff: 'onboard.stuff.title',
    extras: 'onboard.extras.title',
  };

  const BUILD: Record<Step, () => HTMLElement[]> = {
    welcome: () => [
      h('p', { class: 'onboard-lede' }, t('onboard.welcome.lede')),
      h(
        'div',
        { class: 'onboard-language' },
        h('h2', { class: 'onboard-subhead', id: 'onboard-language' }, t('onboard.welcome.language')),
        languageGrid(mode),
      ),
      h('p', { class: 'onboard-note' }, t('onboard.welcome.time')),
    ],
    look: () => [h('p', { class: 'onboard-lede' }, t('onboard.look.lede', { settings: t('settings.nav.title'), appearance: t('settings.nav.appearance') })), looksSection('onboarding', () => {})],
    stuff: () => [h('p', { class: 'onboard-lede' }, t('onboard.stuff.lede')), ...stuffChoices()],
    extras: () => [h('p', { class: 'onboard-lede' }, t('onboard.extras.lede')), tmdbBlock(), h('div', { class: 'onboard-section onboard-debrid' }, debridSection({ intro: t('onboard.extras.debrid-lede') }))],
  };

  const SOURCES: Record<Source, () => HTMLElement[]> = {
    stremio: () => [stremioSection({ heading: false })],
    server: () => [jellyfinSection(), plexSection()],
    addon: addonSection,
  };

  /**
   * "Paste an addon link": the Addons page's own install field and review, with where addon links
   * come from. Without it a newcomer with no Stremio account had no way here to add the addon
   * that "To play something, add an addon" asks for.
   */
  function addonSection(): HTMLElement[] {
    const status = h('p', { class: 'status', role: 'status' });
    const install = createInstallPanel(async (addon) => {
      status.textContent = t('integrations.addons.installed-done', { name: addon.manifest?.name ?? addon.displayHost });
    });
    return [h('p', { class: 'onboard-note' }, t('addonspage.where-from')), install.element, status];
  }

  function stuffChoices(): HTMLElement[] {
    const option = (id: Source | 'later', glyph: IconName, label: MessageKey, hint: string) => {
      const button = h(
        'button',
        { class: 'onboard-option', 'data-source': id },
        h('span', { class: 'onboard-option-icon', 'aria-hidden': 'true' }, icon(glyph)),
        h('span', { class: 'onboard-option-text' }, h('span', { class: 'onboard-option-name' }, t(label)), h('span', { class: 'onboard-option-hint' }, hint)),
        h('span', { class: 'onboard-option-go', 'aria-hidden': 'true' }, icon('chevronRight')),
      );
      button.addEventListener('click', () => (id === 'later' ? show('extras') : showSource(id)));
      return button;
    };
    return [
      h(
        'div',
        { class: 'onboard-options', role: 'group', 'aria-label': t('onboard.stuff.options') },
        option('stremio', 'link', 'onboard.stuff.stremio', t('onboard.stuff.stremio-hint')),
        option('addon', 'addons', 'onboard.stuff.addon', t('onboard.stuff.addon-hint')),
        option('server', 'tv', 'onboard.stuff.server', t('onboard.stuff.server-hint')),
        option('later', 'clock', 'onboard.stuff.later', t('onboard.stuff.later-hint', { addons: t('settings.nav.addons'), accounts: t('settings.nav.accounts') })),
      ),
    ];
  }

  function close(): void {
    if (closed) return;
    closed = true;
    showing = false;
    removeBack();
    removeLayer();
    overlay.remove();
    if (returnFocus instanceof HTMLElement && returnFocus !== document.body && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    // A new install's setup opens before anything has focus: the first arrow press then went to whatever lay
    // nearest Finish or Skip (the title bar's Quick settings), rather than to the page's start.
    else forgetFocus();
    // Last: what waited for setup (an install link) may open a page of its own.
    setSetupOpen(false);
  }

  let saving = false;
  /**
   * Finish or Skip: a TMDB or debrid key typed but not saved is saved first, not dropped. If one
   * can't be, Finish stays open on it, with the reason beside the field; Skip closes anyway.
   */
  async function done(skip: boolean): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      // The step on screen, and the extras if they were left with Back.
      const roots = [body, ...(extras ?? []).filter((el) => !body.contains(el))];
      const save = async () => (await Promise.all(roots.map(saveTypedKeys))).every(Boolean);
      if (await closesAfterSaving(save, skip)) finish();
    } finally {
      saving = false;
    }
  }

  /** Ends setup, finished or skipped. */
  function finish(): void {
    if (closed) return;
    if (mode === 'first') {
      void markOnboarded()
        .then(startChecklist)
        .catch((err: unknown) => reportError('Could not save that setup is done', err, 'warn'))
        .finally(() => document.dispatchEvent(new Event(ONBOARDING_CLOSED)));
    }
    close();
  }

  const removeBack = onBack(goBack);
  document.body.append(overlay);
  // Only Finish and Skip end it: a page change behind it (an install link, a shortcut) must not drop what was typed.
  const removeLayer = pushLayer(overlay, null);
  setSetupOpen(true);
  show('welcome');
}

/** Restarts the step's entrance, so moving between steps reads as a change. */
function replay(element: HTMLElement): void {
  element.classList.remove('entering');
  void element.offsetWidth;
  element.classList.add('entering');
}

/** Each language by its own name. Picking another saves it and reopens setup here in that language. */
function languageGrid(mode: SetupMode): HTMLElement {
  const name = (choice: LanguageChoice) =>
    choice === 'system' ? t('settings.general.language-system-is', { name: LANGUAGES.find((l) => l.id === systemLanguage())!.name }) : LANGUAGES.find((l) => l.id === choice)!.name;
  const current = languageChoice();
  const buttons = (['system', ...LANGUAGES.map((l) => l.id)] as LanguageChoice[]).map((choice) => {
    const button = h('button', { class: 'onboard-language-option', 'aria-pressed': String(choice === current), ...(choice === 'system' ? {} : { lang: choice }) }, name(choice));
    button.addEventListener('click', () => {
      if (choice === languageChoice()) return;
      for (const b of buttons) b.disabled = true;
      void setLanguage(choice)
        .then(() => {
          // Every page is drawn in the old language: start over in the new one, back on this step.
          rememberResume(mode);
          return invoke('player_stop').catch(() => {});
        })
        .then(() => location.reload())
        .catch((err: unknown) => {
          reportError('Could not change the language', err);
          for (const b of buttons) b.disabled = false;
        });
    });
    return button;
  });
  return h('div', { class: 'onboard-language-grid', role: 'group', 'aria-labelledby': 'onboard-language' }, ...buttons);
}

/** What a TMDB key adds, where to get one, and the field from Settings. */
function tmdbBlock(): HTMLElement {
  const perks: MessageKey[] = ['onboard.extras.tmdb-trending', 'onboard.extras.tmdb-recs', 'onboard.extras.tmdb-anime', 'onboard.extras.tmdb-where'];
  const get = h('button', { class: 'button' }, t('onboard.extras.tmdb-get'), icon('chevronRight'));
  get.addEventListener('click', () => void openInBrowser(TMDB_KEY_PAGE).catch((err: unknown) => reportError('Could not open TMDB', err, 'warn')));
  return h(
    'div',
    { class: 'onboard-section onboard-tmdb' },
    h('h2', { class: 'onboard-subhead' }, 'TMDB'),
    h('p', { class: 'onboard-note' }, t('onboard.extras.tmdb-lede')),
    h('ul', { class: 'onboard-perks' }, ...perks.map((key) => h('li', {}, icon('check'), h('span', {}, t(key))))),
    h('div', { class: 'onboard-get' }, get, h('span', { class: 'onboard-note' }, t('onboard.extras.tmdb-steps'))),
    tmdbRow(() => {}),
  );
}
