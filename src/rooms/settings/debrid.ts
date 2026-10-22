/**
 * Settings → Integrations → Debrid accounts: the person's own Real-Debrid
 * and TorBox accounts, any or all at once, for My Library → My cloud. A key
 * goes to Rust, which checks it with the provider and keeps it in the OS
 * keychain; the page only ever learns whose account it is.
 */
import { openInBrowser } from '../../lib/browser';
import { icon } from '../../components/icons';
import { createTextField } from '../../components/text-field';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { checkCloudAccounts, CLOUD_PROVIDERS, cloudAccounts, connectCloud, disconnectCloud, type CloudAccount, type CloudProblem, type CloudProvider } from '../../library/cloud';
import { row } from './playback';
import { keyField } from './typed-keys';
import { errorText } from '../../components/state-message';

/** "Connected · sam · premium until 3 Dec 2026". */
export function accountLine(account: CloudAccount, now = Date.now(), tag = locale()): string {
  const connected = t('cloud.settings.connected', { user: account.userName });
  if (account.premiumUntil === null || account.premiumUntil <= now) return `${connected} · ${t('cloud.settings.free')}`;
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(account.premiumUntil);
  return `${connected} · ${t('cloud.settings.premium-until', { date })}`;
}

/** What a provider's problem means, in words (also used by My cloud). */
export function problemText(problem: CloudProblem, name: string): string {
  switch (problem.kind) {
    case 'denied':
      return t('cloud.problem.denied', { provider: name });
    case 'rate-limited':
      return t('cloud.problem.rate-limited', { provider: name, seconds: problem.retryIn ?? 30 });
    case 'unreachable':
      return t('cloud.problem.unreachable', { provider: name });
    case 'restricted':
      return t(problem.section === 'web' ? 'cloud.problem.restricted-web' : 'cloud.problem.restricted-usenet', { provider: name });
    default:
      return t('cloud.problem.failed', { provider: name });
  }
}

/** `intro`: the line under the heading, in place of Settings' own (first-run setup has a shorter one). */
export function debridSection({ intro }: { intro?: string } = {}): HTMLElement {
  const body = h('div', {});
  const rows = new Map<CloudProvider, { element: HTMLElement; message: HTMLElement }>();
  for (const provider of CLOUD_PROVIDERS) {
    const message = h('p', { class: 'provider-message', role: 'status' });
    const element = h('div', {});
    rows.set(provider.id, { element, message });
    body.append(element, message);
  }

  function draw(provider: (typeof CLOUD_PROVIDERS)[number], account: CloudAccount | undefined): void {
    const slot = rows.get(provider.id)!;
    if (account) {
      const remove = h('button', { class: 'button danger' }, t('cloud.settings.remove'));
      // Flags rather than `disabled` while the service is asked: disabling the focused button would drop focus to the page.
      let removing = false;
      remove.addEventListener('click', () => {
        if (removing) return;
        removing = true;
        remove.setAttribute('aria-busy', 'true');
        void disconnectCloud(provider.id)
          .then(() => {
            slot.message.textContent = t('cloud.settings.removed', { provider: provider.name });
            draw(provider, undefined);
            slot.element.querySelector<HTMLElement>('button, input')?.focus();
          })
          .catch((err: unknown) => {
            slot.message.textContent = errorText(err, { service: 'debrid', action: true });
            removing = false;
            remove.removeAttribute('aria-busy');
          });
      });
      slot.element.replaceChildren(row(provider.name, accountLine(account), h('div', { class: 'provider-key' }, remove)));
      return;
    }
    const field = createTextField({ label: t('cloud.settings.key-label', { provider: provider.name }), placeholder: t('cloud.settings.key-placeholder'), onSubmit: () => void connect() });
    field.type = 'password';
    const connectButton = h('button', { class: 'button primary' }, t('cloud.settings.connect'));
    connectButton.addEventListener('click', () => void connect());
    const getKey = h('button', { class: 'button icon-only', title: t('cloud.settings.get-key', { provider: provider.name }), 'aria-label': t('cloud.settings.get-key', { provider: provider.name }) }, icon('link'));
    getKey.addEventListener('click', () => void openInBrowser(provider.keyPage).catch((err: unknown) => (slot.message.textContent = errorText(err, { service: 'debrid', action: true }))));
    keyField(field, connect);
    let connecting = false;
    async function connect(): Promise<boolean> {
      const key = field.value.trim();
      if (connecting || !key) return false;
      connecting = true;
      connectButton.setAttribute('aria-busy', 'true');
      slot.message.textContent = t('cloud.settings.checking', { provider: provider.name });
      try {
        const added = await connectCloud(provider.id, key);
        slot.message.textContent = t('cloud.settings.added', { provider: provider.name });
        draw(provider, added);
        slot.element.querySelector<HTMLElement>('button')?.focus();
        return true;
      } catch (err) {
        slot.message.textContent = errorText(err, { service: 'debrid', action: true });
        connecting = false;
        connectButton.removeAttribute('aria-busy');
        return false;
      } finally {
        field.value = '';
      }
    }
    slot.element.replaceChildren(row(provider.name, t('cloud.settings.key-hint', { provider: provider.name }), h('div', { class: 'provider-key' }, field, connectButton, getKey)));
  }

  function drawAll(accounts: readonly CloudAccount[]): void {
    for (const provider of CLOUD_PROVIDERS) draw(provider, accounts.find((a) => a.provider === provider.id));
  }

  void cloudAccounts().then((accounts) => {
    drawAll(accounts);
    if (!accounts.length) return;
    // Today's premium dates, and any key revoked since, without holding up the page.
    void checkCloudAccounts()
      .then(({ accounts: fresh, problems }) => {
        for (const provider of CLOUD_PROVIDERS) {
          const account = fresh.find((a) => a.provider === provider.id);
          const slot = rows.get(provider.id)!;
          // A row the person is typing a key into is left alone.
          if (account && !slot.element.contains(document.activeElement)) draw(provider, account);
          const problem = problems.find((p) => p.provider === provider.id);
          // Here, a revoked key's fix is the row itself (My cloud's words send the person to Settings).
          if (problem) slot.message.textContent = problem.kind === 'denied' ? t('cloud.settings.denied', { provider: provider.name }) : problemText(problem, provider.name);
        }
      })
      .catch((err: unknown) => console.warn('Could not check the debrid accounts', err));
  });

  return h(
    'div',
    { class: 'debrid-section' },
    h('h3', { class: 'settings-subheading' }, t('cloud.settings.heading')),
    h('p', { class: 'muted settings-intro' }, intro ?? t('cloud.settings.intro')),
    body,
  );
}
