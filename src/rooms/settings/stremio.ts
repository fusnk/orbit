/**
 * Settings → Integrations → Stremio: sign in (through the browser, or with an
 * email and password) and import the account's addons. The session and the
 * addons' URLs stay in Rust (see src-tauri/src/stremio.rs); this page sees
 * the account's email and each addon's manifest.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as v from 'valibot';
import { forgetList } from '../../addons/registry';
import { ManifestSchema } from '../../addons/schema';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { activeProfileId } from '../../library/profiles';
import { checkStremioAccount, noteStremioAccount, setSyncEnabled, stremioSyncState, syncEnabled, syncNow } from '../../library/stremio-sync';
import { row } from './playback';
import { errorText } from '../../components/state-message';
import { isAndroid } from '../../lib/platform';
import { maskEmail } from '../../lib/mask-email';

interface Offered {
  index: number;
  host: string;
  official: boolean;
  manifest: unknown;
}

/** `heading`: false in first-run setup, where the step is already about Stremio and the row names it. */
export function stremioSection({ heading = true }: { heading?: boolean } = {}): HTMLElement {
  const control = h('div', { class: 'provider-key' });
  const message = h('p', { class: 'provider-message', role: 'status' });
  const importArea = h('div', { class: 'stremio-import' });
  const syncArea = h('div', {});
  /**
   * Whether this section is waiting on a browser sign-in it started. Only then does one failing say
   * anything: one given up on (signed in with a password meanwhile, or started from a Settings page
   * since redrawn) would otherwise show a signed-in account as signed out minutes later.
   */
  let awaitingBrowser = false;

  /** Brings in Stremio's progress now, saying how it went. */
  function sync(): void {
    message.textContent = t('integrations.stremio.syncing');
    void syncNow()
      .then((n) => {
        // Stremio ended the session while syncing (syncNow answers 0 then): say so, and offer signing in again.
        if (stremioSyncState().signedIn === false) return showSessionEnded();
        message.textContent = n ? tn('integrations.stremio.synced', n) : t('integrations.stremio.in-sync');
      })
      .catch((err: unknown) => (message.textContent = errorText(err, { service: 'stremio', action: true })));
  }

  function showSessionEnded(): void {
    // Sync now goes away with the session: focus moves on to Sign in rather than the page.
    const hadFocus = syncArea.contains(document.activeElement);
    message.textContent = t('states.auth.stremio');
    importArea.replaceChildren();
    showSync(false);
    showSignedOut();
    if (hadFocus) control.querySelector<HTMLElement>('button')?.focus();
  }

  function showSync(signedIn: boolean): void {
    if (!signedIn) return void syncArea.replaceChildren();
    const now = h('button', { class: 'button' }, t('integrations.stremio.sync-now'));
    now.addEventListener('click', sync);
    now.hidden = !syncEnabled();
    const toggle = createSwitch('', syncEnabled(), (on) => {
      now.hidden = !on;
      void setSyncEnabled(on).catch((err: unknown) => (message.textContent = errorText(err, { service: 'stremio', action: true })));
    });
    toggle.setAttribute('aria-label', t('integrations.stremio.sync-label'));
    syncArea.replaceChildren(
      row(t('integrations.stremio.sync'), t('integrations.stremio.sync-hint'), h('div', { class: 'wallpaper-control' }, now, toggle)),
    );
  }

  function showSignedIn(email: string): void {
    awaitingBrowser = false;
    const importButton = h('button', { class: 'button' }, t('integrations.stremio.import'));
    importButton.addEventListener('click', () => void offerAddons());
    const signOut = h('button', { class: 'button danger' }, t('integrations.stremio.sign-out'));
    signOut.addEventListener('click', () => {
      void invoke('stremio_logout')
        .then(() => {
          message.textContent = t('integrations.stremio.signed-out');
          importArea.replaceChildren();
          showSync(false);
          showSignedOut();
        })
        .catch((err: unknown) => (message.textContent = errorText(err, { service: 'stremio', action: true })));
    });
    // Masked so a screenshot of Settings doesn't show it; the whole address on hover.
    control.replaceChildren(h('span', { class: 'provider-status', title: email }, maskEmail(email)), importButton, signOut);
    showSync(true);
    noteStremioAccount(true);
  }

  function showSignedOut(): void {
    const browser = h('button', { class: 'button primary' }, t('integrations.stremio.sign-in-browser'));
    // Flags rather than `disabled` while waiting: disabling the focused button would drop focus to the page.
    let waiting = false;
    browser.addEventListener('click', () => {
      if (waiting) return;
      waiting = awaitingBrowser = true;
      browser.setAttribute('aria-busy', 'true');
      message.textContent = t('integrations.stremio.finish-in-browser');
      void invoke('stremio_browser_login').catch((err: unknown) => {
        message.textContent = errorText(err, { service: 'stremio', action: true });
        waiting = awaitingBrowser = false;
        browser.removeAttribute('aria-busy');
      });
    });
    const withPassword = h('button', { class: 'button' }, t('integrations.stremio.use-password'));
    withPassword.addEventListener('click', showPasswordForm);
    control.replaceChildren(browser, withPassword);
    noteStremioAccount(false);
  }

  function showPasswordForm(): void {
    awaitingBrowser = false;
    const email = createTextField({ label: t('integrations.stremio.email-label'), placeholder: t('integrations.stremio.email-placeholder'), onSubmit: () => void submit() });
    const password = createTextField({ label: t('integrations.stremio.password-label'), placeholder: t('integrations.common.password'), onSubmit: () => void submit() });
    password.type = 'password';
    email.type = 'email';
    const go = h('button', { class: 'button primary' }, t('integrations.stremio.sign-in'));
    go.addEventListener('click', () => void submit());
    let signingIn = false;
    async function submit(): Promise<void> {
      if (signingIn || !email.value.trim() || !password.value) return;
      signingIn = true;
      go.setAttribute('aria-busy', 'true');
      message.textContent = t('integrations.stremio.signing-in');
      try {
        const account = await invoke<{ email: string }>('stremio_login', { email: email.value, password: password.value });
        password.value = '';
        const hadFocus = control.contains(document.activeElement);
        showSignedIn(account.email);
        // The form is gone: focus goes to the signed-in row's first button rather than the page.
        if (hadFocus) control.querySelector<HTMLElement>('button')?.focus();
        if (syncEnabled()) sync();
      } catch (err) {
        message.textContent = errorText(err, { service: 'stremio', action: true });
        signingIn = false;
        go.removeAttribute('aria-busy');
      }
    }
    control.replaceChildren(email, password, go);
    // "Use password" replaced itself: focus goes on to the email field (Enter there starts typing).
    email.focus();
  }

  /** The account's addons as a checklist; Orbit's own copies (like Cinemeta) are left out. */
  async function offerAddons(): Promise<void> {
    message.textContent = t('integrations.stremio.getting-addons');
    let offered: Offered[];
    try {
      offered = await invoke<Offered[]>('stremio_addons');
    } catch (err) {
      message.textContent = errorText(err, { service: 'stremio', action: true });
      return;
    }
    const usable = offered.flatMap((o) => {
      const parsed = v.safeParse(ManifestSchema, o.manifest);
      return parsed.success && !o.official ? [{ ...o, manifest: parsed.output }] : [];
    });
    message.textContent = usable.length ? '' : t('integrations.stremio.no-addons');
    if (!usable.length) return importArea.replaceChildren();
    const boxes = usable.map((o) => {
      const box = h('input', { type: 'checkbox', checked: true, 'aria-label': o.manifest.name });
      return { o, box, label: h('label', { class: 'stremio-addon' }, box, h('span', { class: 'stremio-addon-name' }, o.manifest.name), h('span', { class: 'muted' }, o.host)) };
    });
    const go = h('button', { class: 'button primary' }, t('integrations.stremio.import-selected'));
    // A flag rather than `disabled` while adding: disabling the focused button would drop focus to the page.
    let adding = false;
    go.addEventListener('click', () => {
      if (adding) return;
      adding = true;
      go.setAttribute('aria-busy', 'true');
      void (async () => {
        let done = 0;
        for (const { o, box } of boxes) {
          if (!box.checked) continue;
          try {
            await invoke('stremio_install_addon', { index: o.index, manifest: o.manifest }).finally(forgetList);
            done++;
          } catch {
            toast(t('integrations.stremio.add-failed', { name: o.manifest.name }));
          }
        }
        const hadFocus = importArea.contains(document.activeElement);
        importArea.replaceChildren();
        message.textContent = tn('integrations.stremio.added', done);
        // The checklist is gone: focus goes back to Import addons rather than the page.
        if (hadFocus) control.querySelector<HTMLElement>('button')?.focus();
      })();
    });
    importArea.replaceChildren(h('p', { class: 'muted' }, t('integrations.stremio.choose')), ...boxes.map((b) => b.label), h('div', { class: 'import-actions' }, go));
  }

  /** Offline or a timeout says nothing about the account: what's known about it stays as it was. */
  function showUnreachable(): void {
    const retry = h('button', { class: 'button' }, t('integrations.stremio.retry'));
    retry.addEventListener('click', () => {
      const focused = document.activeElement === retry;
      retry.disabled = true;
      checkAccount(focused);
    });
    control.replaceChildren(h('span', { class: 'provider-status' }, t('integrations.stremio.unreachable')), retry);
  }

  /** Asks Stremio about the account; `refocus` puts focus on the new controls (it was on Try again, now replaced). */
  function checkAccount(refocus = false): void {
    void checkStremioAccount().then((account) => {
      if (account === 'unreachable') showUnreachable();
      else if (account) showSignedIn(account.email);
      else showSignedOut();
      if (refocus) control.querySelector('button')?.focus();
    });
  }
  checkAccount();

  const section = h(
    'div',
    { class: 'stremio-section' },
    heading ? h('h3', { class: 'settings-subheading' }, 'Stremio') : '',
    row(t('integrations.stremio.account'), t(isAndroid ? 'integrations.stremio.account-hint-android' : 'integrations.stremio.account-hint'), control),
    syncArea,
    message,
    importArea,
  );
  // A browser sign-in finishes in the background.
  section.addEventListener(SIGNED_IN, (event) => {
    const payload = (event as CustomEvent<SignedIn>).detail;
    if (payload.email) {
      showSignedIn(payload.email);
      if (syncEnabled()) sync();
    } else if (awaitingBrowser) {
      awaitingBrowser = false;
      message.textContent = errorText(payload.error, { service: 'stremio', fallback: 'integrations.stremio.sign-in-failed', action: true });
      showSignedOut();
    }
  });
  followSignIns(section);
  return section;
}

interface SignedIn {
  /** The profile that started the sign-in (the session was saved for it). */
  profile: string;
  email?: string;
  error?: string;
}

const SIGNED_IN = 'orbit:stremio-signed-in';
/**
 * Sections built so far, held weakly: one gone with a redraw can be freed, and
 * one merely out of the page (Settings kept behind another view) still hears
 * about a sign-in. One app-wide listener passes it on, however many were built.
 */
const sections = new Set<WeakRef<HTMLElement>>();
let listening = false;

function followSignIns(section: HTMLElement): void {
  sections.add(new WeakRef(section));
  if (listening) return;
  listening = true;
  void listen<SignedIn>('stremio://signed-in', async ({ payload }) => {
    // Another profile's sign-in (started before a switch) says nothing about this one's account.
    if (payload.profile !== (await activeProfileId().catch(() => null))) return;
    for (const ref of sections) {
      const el = ref.deref();
      if (el) el.dispatchEvent(new CustomEvent(SIGNED_IN, { detail: payload }));
      else sections.delete(ref);
    }
  });
}
