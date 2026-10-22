/**
 * Settings → Appearance → Posters: Orbit's scores on posters, and where
 * posters come from (Orbit, or RPDB with the person's key). The key goes to
 * Rust, which checks it with RPDB and keeps it in the OS keychain; the page
 * only learns whether one is saved (catalog/rpdb.ts).
 */
import { clearRpdbKey, loadRpdb, rpdbKeySaved, setRpdbKey } from '../../catalog/rpdb';
import { errorText } from '../../components/state-message';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { appearance, RPDB_STYLES, setAppearance, type Appearance } from '../../theme/appearance';
import { showDependents } from './dependent-rows';
import { choices, row } from './playback';
import { keyField } from './typed-keys';

const set = (patch: Partial<Appearance>) =>
  void setAppearance(patch).catch((err: unknown) => {
    console.error('Could not save setting', err);
    toast(t('settings.common.save-failed'));
  });

const STYLE_NAMES: Record<(typeof RPDB_STYLES)[number], MessageKey> = {
  'poster-default': 'posters.rpdb.style-default',
  'poster-certs': 'posters.rpdb.style-certs',
  'poster-mc': 'posters.rpdb.style-mc',
  'poster-rt': 'posters.rpdb.style-rt',
  'textless-default': 'posters.rpdb.style-textless',
};

/** Rust's refusals are codes (rpdb.rs); anything else is an ordinary error. */
const KEY_ERRORS: Record<string, MessageKey> = {
  'rpdb.key-format': 'posters.rpdb.key-format',
  'rpdb.refused': 'posters.rpdb.refused',
  'rpdb.busy': 'posters.rpdb.busy',
  'rpdb.unreachable': 'posters.rpdb.unreachable',
};
const keyError = (err: unknown) => (typeof err === 'string' && KEY_ERRORS[err] ? t(KEY_ERRORS[err]) : errorText(err));

export function posterRows(): HTMLElement[] {
  const a = appearance();
  const ratings = row(
    t('posters.ratings'),
    t('posters.ratings-hint'),
    choices(
      t('posters.ratings'),
      [
        ['off', t('settings.common.off')],
        ['minimal', t('posters.ratings-minimal')],
        ['full', t('posters.ratings-full')],
      ] as const,
      a.posterRatings,
      (posterRatings) => set({ posterRatings }),
    ),
  );
  const key = rpdbKeyRow();
  const style = row(t('posters.rpdb.style'), t('posters.rpdb.style-hint'), choices(t('posters.rpdb.style'), RPDB_STYLES.map((s) => [s, t(STYLE_NAMES[s])] as const), a.rpdbStyle, (rpdbStyle) => set({ rpdbStyle })));
  const provider = row(
    t('posters.provider'),
    t('posters.provider-hint'),
    choices(
      t('posters.provider'),
      [
        ['orbit', t('posters.provider-orbit')],
        ['rpdb', 'RPDB'],
      ] as const,
      a.posterProvider,
      (posterProvider) => {
        set({ posterProvider });
        showDependents(provider, [key, style], posterProvider === 'rpdb');
      },
    ),
  );
  showDependents(provider, [key, style], a.posterProvider === 'rpdb');
  return [ratings, provider, key, style];
}

/** The RPDB key: a field and Save, or "Saved" and Remove. */
function rpdbKeyRow(): HTMLElement {
  const control = h('div', { class: 'provider-key' });
  const message = h('p', { class: 'provider-message', role: 'status' });

  function showSaved(): void {
    const remove = h('button', { class: 'button danger' }, t('integrations.common.remove'));
    remove.addEventListener('click', () => {
      void clearRpdbKey()
        .then(() => {
          message.textContent = t('posters.rpdb.removed');
          showEmpty();
        })
        .catch((err: unknown) => (message.textContent = errorText(err)));
    });
    control.replaceChildren(h('span', { class: 'provider-status' }, t('posters.rpdb.saved')), remove);
  }

  function showEmpty(): void {
    const field = createTextField({ label: t('posters.rpdb.key'), placeholder: t('posters.rpdb.key-placeholder'), onSubmit: () => void save() });
    field.type = 'password';
    const saveButton = h('button', { class: 'button primary' }, t('integrations.common.save'));
    saveButton.addEventListener('click', () => void save());
    keyField(field, save);
    async function save(): Promise<boolean> {
      if (!field.value.trim()) return false;
      saveButton.disabled = true;
      message.textContent = t('posters.rpdb.checking');
      try {
        await setRpdbKey(field.value);
        message.textContent = t('posters.rpdb.connected');
        showSaved();
        return true;
      } catch (err) {
        message.textContent = keyError(err);
        saveButton.disabled = false;
        return false;
      }
    }
    control.replaceChildren(field, saveButton);
  }

  // Start-up only asks the keychain when RPDB was already the provider.
  void loadRpdb().then(() => (rpdbKeySaved() ? showSaved() : showEmpty()));
  return h('div', { class: 'rpdb-key-row' }, row(t('posters.rpdb.key'), t('posters.rpdb.key-hint'), control), message);
}
