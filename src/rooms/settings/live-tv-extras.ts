/**
 * Settings → Live TV, per source: what an Xtream panel says about the
 * account (days left, connections), and the source's own guides. Both come
 * from Rust without the login: account details carry none, and guides are
 * shown by host only (their addresses can hold a login).
 */
import { icon } from '../../components/icons';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { accountState, changeTvGuides, tvAccount, tvGuides, type TvAccount, type TvGuides, type TvSource } from '../../live/iptv';
import { errorText } from '../../components/state-message';

/** "Active · 12 days left (ends 17 Oct 2026) · 1 of 2 connections in use". */
export function accountText(account: TvAccount, nowMs = Date.now()): { text: string; warning: boolean } {
  const state = accountState(account, nowMs);
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const parts: string[] = [];
  if (state.kind === 'expired') parts.push(t('livetv.account.expired'));
  else if (state.kind === 'inactive') parts.push(t('livetv.account.inactive', { status: state.status }));
  else if (state.kind === 'unlimited') parts.push(t('livetv.account.unlimited'));
  else parts.push(`${tn('livetv.account.days-left', state.days)} (${t('livetv.account.ends', { date: date(account.expires!) })})`);
  if (account.maxConnections !== null) {
    parts.push(
      account.activeConnections !== null
        ? t('livetv.account.connections', { active: account.activeConnections, max: account.maxConnections })
        : t('livetv.account.max-connections', { max: account.maxConnections }),
    );
  }
  if (account.trial) parts.push(t('livetv.account.trial'));
  // A week's notice before it runs out.
  const warning = state.kind === 'expired' || state.kind === 'inactive' || (state.kind === 'days' && state.days <= 7);
  return { text: parts.join(' · '), warning };
}

/** The account line for an Xtream source: what's known now, then the panel's fresh answer. */
export function accountLine(source: TvSource): HTMLElement | null {
  if (source.kind !== 'xtream') return null;
  const line = h('span', { class: 'setting-hint tv-account' });
  const show = (account: TvAccount | null) => {
    if (!account) return;
    const { text, warning } = accountText(account);
    line.textContent = text;
    line.classList.toggle('warning', warning);
  };
  show(source.account);
  void tvAccount(source.id).then(show, () => {});
  return line;
}

/** A source's own guides: listed by host, in order, with Move up / Remove, and a field to add one. */
export function guidesPanel(source: TvSource): HTMLElement {
  const list = h('div', { class: 'tv-guides-list' });
  const message = h('p', { class: 'provider-message', role: 'status' });
  const field = createTextField({ label: t('livetv.guides.address'), placeholder: t('livetv.guides.placeholder'), onSubmit: () => void add() });
  field.type = 'url';
  const addButton = h('button', { class: 'button' }, icon('plus'), t('livetv.guides.add'));
  addButton.addEventListener('click', () => void add());

  /** Runs a change and shows the result; false (with the reason shown) if it failed. */
  async function change(run: () => Promise<TvGuides>, focusId?: string): Promise<boolean> {
    message.textContent = '';
    try {
      draw(await run());
      // What had focus may be gone (a removed guide): the field to add one takes it.
      if (focusId) (list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) ?? addButton).focus({ preventScroll: true });
      return true;
    } catch (err) {
      message.textContent = errorText(err, { service: 'iptv' });
      return false;
    }
  }

  async function add(): Promise<void> {
    const url = field.value.trim();
    if (!url) return;
    addButton.disabled = true;
    if (await change(() => changeTvGuides(source.id, { kind: 'add', url }))) {
      field.value = '';
      message.textContent = t('livetv.guides.added');
    }
    addButton.disabled = false;
  }

  function draw(guides: TvGuides): void {
    const fallback = { provider: 'livetv.guides.fallback-provider', playlist: 'livetv.guides.fallback-playlist', none: 'livetv.guides.fallback-none' } as const;
    if (!guides.own.length) {
      list.replaceChildren(h('p', { class: 'muted' }, t(fallback[guides.fallback])));
      return;
    }
    list.replaceChildren(
      ...guides.own.map((guide, index) => {
        const n = index + 1;
        const up = h('button', { class: 'button', 'data-focus-id': `guide:${index}:up`, disabled: index === 0, 'aria-label': t('livetv.guides.move-up', { n }), title: t('livetv.guides.move-up', { n }) }, icon('chevronUp'));
        up.addEventListener('click', () => void change(() => changeTvGuides(source.id, { kind: 'up', index }), `guide:${index - 1}:${index - 1 === 0 ? 'remove' : 'up'}`));
        const remove = h('button', { class: 'button danger', 'data-focus-id': `guide:${index}:remove`, 'aria-label': t('livetv.guides.remove', { n }) }, t('integrations.common.remove'));
        remove.addEventListener('click', () => void change(() => changeTvGuides(source.id, { kind: 'remove', index }), `guide:${Math.max(0, index - 1)}:remove`));
        return h(
          'div',
          { class: 'tv-guide' },
          h('span', { class: 'tv-guide-name' }, t('livetv.guides.item', { n }), h('span', { class: 'muted' }, ` · ${guide.host}`), guide.insecure ? h('span', { class: 'tv-insecure', title: t('integrations.live-tv.insecure-title') }, t('integrations.live-tv.insecure')) : ''),
          h('span', { class: 'tv-source-actions' }, up, remove),
        );
      }),
    );
  }

  void tvGuides(source.id).then(draw, (err: unknown) => toast(errorText(err, { service: 'iptv' })));
  return h(
    'div',
    { class: 'tv-guides' },
    h('p', { class: 'setting-hint' }, t('livetv.guides.hint')),
    list,
    h('div', { class: 'tv-guide-add' }, field, addButton),
    message,
  );
}
