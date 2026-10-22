/**
 * Settings → Subtitles → Translate subtitles with AI (off by default): the
 * service (a model server on this PC, OpenAI, Gemini or Claude), its key, the
 * model, the language to translate into, and a connection test. The player's
 * Subtitles menu then offers "Translate to…" (see player/subtitle-translate.ts).
 *
 * The key goes to Rust once and is kept in the system keychain for this
 * profile; the page can only ask whether one is saved, never read it back.
 */
import { invoke } from '@tauri-apps/api/core';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { languageName } from '../../lib/languages';
import { LANGUAGE_CHOICES } from '../player/preferred-language';
import { AI_SUBS_ENABLED_KEY, AI_SUBS_KEY, errorMessage, parseAiSubs, type AiProvider, type AiSubs } from '../player/subtitle-translate';
import { showDependents } from './dependent-rows';
import { choices, row, save } from './playback';
import { keyField } from './typed-keys';
import { errorText } from '../../components/state-message';

const PROVIDER_NAMES: readonly (readonly [AiProvider, string])[] = [
  ['local', t('subtrans.settings.provider-local')],
  ['openai', t('subtrans.settings.provider-openai')],
  ['gemini', t('subtrans.settings.provider-gemini')],
  ['claude', t('subtrans.settings.provider-claude')],
];

/** What Rust needs to reach the service now chosen. */
const configOf = (prefs: AiSubs) => ({ provider: prefs.provider, model: prefs.models[prefs.provider], server: prefs.provider === 'local' ? prefs.server : '' });

/** The section's heading, note and rows, from the saved on/off and choices. */
export function aiTranslationSection(enabledValue: unknown, savedValue: unknown): HTMLElement[] {
  let prefs = parseAiSubs(savedValue);
  let enabled = enabledValue === true;
  const store = () => void save(AI_SUBS_KEY, prefs);
  /** The models the service listed last, for "Choose a model". */
  let listed: { provider: AiProvider; models: string[] } | null = null;
  /** Bumped whenever the service shown changes, so a reply for an earlier choice can't redraw the key or model controls. */
  let generation = 0;
  const stillShown = (provider: AiProvider, gen: number) => gen === generation && prefs.provider === provider;

  // Provider.
  const providerRow = row(
    t('subtrans.settings.provider'),
    '',
    choices(t('subtrans.settings.provider'), PROVIDER_NAMES, prefs.provider, (provider) => {
      prefs = { ...prefs, provider };
      store();
      drawProvider();
    }),
  );

  // Local server address (Rust accepts only one on this PC, and says so if it isn't).
  const server = createTextField({ label: t('subtrans.settings.server'), placeholder: 'http://127.0.0.1:1234/v1', onSubmit: () => server.blur() });
  server.value = prefs.server;
  server.addEventListener('change', () => {
    prefs = { ...prefs, server: server.value.trim().slice(0, 200) || parseAiSubs(null).server };
    // An emptied field shows the address that's used instead.
    server.value = prefs.server;
    store();
  });
  const serverRow = row(t('subtrans.settings.server'), t('subtrans.settings.server-hint'), server);

  // API key: write-only.
  const keyControl = h('div', { class: 'provider-key' });
  const keyMessage = h('p', { class: 'provider-message', role: 'status' });
  const keyRow = h('div', {}, row(t('subtrans.settings.key'), t('subtrans.settings.key-hint'), keyControl), keyMessage);

  function showKeySaved(provider: AiProvider): void {
    const gen = generation;
    const remove = h('button', { class: 'button danger' }, t('subtrans.settings.remove'));
    remove.addEventListener('click', () => {
      void invoke('subtrans_forget_key', { provider })
        .then(() => {
          if (!stillShown(provider, gen)) return;
          keyMessage.textContent = t('subtrans.settings.key-removed');
          showKeyEmpty(provider);
        })
        .catch((err: unknown) => stillShown(provider, gen) && (keyMessage.textContent = errorText(err)));
    });
    keyControl.replaceChildren(h('span', { class: 'provider-status' }, t('subtrans.settings.key-saved')), remove);
  }

  function showKeyEmpty(provider: AiProvider): void {
    const gen = generation;
    const field = createTextField({ label: t('subtrans.settings.key'), placeholder: t('subtrans.settings.key-placeholder'), onSubmit: () => void saveKey() });
    field.type = 'password';
    field.maxLength = 512;
    const button = h('button', { class: 'button primary' }, t('subtrans.settings.save'));
    button.addEventListener('click', () => void saveKey());
    keyField(field, saveKey);
    async function saveKey(): Promise<boolean> {
      if (!field.value.trim()) return false;
      button.disabled = true;
      try {
        await invoke('subtrans_set_key', { provider, key: field.value });
        field.value = '';
        if (!stillShown(provider, gen)) return true;
        keyMessage.textContent = '';
        showKeySaved(provider);
        return true;
      } catch (err) {
        if (!stillShown(provider, gen)) return false;
        // Only Rust's `bad-key` is about the key itself; anything else (the keychain) isn't the person's typing.
        keyMessage.textContent = err === 'bad-key' ? t('subtrans.settings.key-bad') : errorText(err);
        button.disabled = false;
        return false;
      }
    }
    keyControl.replaceChildren(field, button);
  }

  // Model: typed, or chosen from what the service lists.
  const model = createTextField({ label: t('subtrans.settings.model'), onSubmit: () => model.blur() });
  model.addEventListener('change', () => {
    prefs = { ...prefs, models: { ...prefs.models, [prefs.provider]: model.value.trim().slice(0, 128) || parseAiSubs(null).models[prefs.provider] } };
    model.value = prefs.models[prefs.provider];
    store();
  });
  const chooseModel = h('button', { class: 'button', 'aria-label': t('subtrans.settings.model-choose'), title: t('subtrans.settings.model-choose') }, icon('chevronDown'));
  chooseModel.addEventListener('click', () => {
    void (async () => {
      const provider = prefs.provider;
      const gen = generation;
      const models = listed?.provider === provider ? listed.models : await listModels();
      // The list came back after the service changed or Settings closed: drop it.
      if (!stillShown(provider, gen) || !chooseModel.isConnected) return;
      const items = (models ?? []).slice(0, 100).map((name) => ({
        label: name,
        action: () => {
          if (prefs.provider !== provider) return;
          prefs = { ...prefs, models: { ...prefs.models, [provider]: name } };
          model.value = name;
          store();
        },
      }));
      openMenuFrom(chooseModel, items.length ? items : [{ label: t('subtrans.settings.model-none'), action: () => {} }]);
    })();
  });
  const modelRow = row(t('subtrans.settings.model'), t('subtrans.settings.model-hint'), h('div', { class: 'provider-key' }, model, chooseModel));

  // Target language.
  const target = h('button', { class: 'button', 'aria-label': t('subtrans.settings.target') });
  const drawTarget = () => target.replaceChildren(prefs.target ? languageName(prefs.target) : t('subtrans.settings.target-app'), icon('chevronDown'));
  drawTarget();
  target.addEventListener('click', () =>
    openMenuFrom(
      target,
      ['', ...LANGUAGE_CHOICES].map((code) => ({
        label: code ? languageName(code) : t('subtrans.settings.target-app'),
        action: () => {
          prefs = { ...prefs, target: code };
          drawTarget();
          store();
        },
      })),
    ),
  );
  const targetRow = row(t('subtrans.settings.target'), t('subtrans.settings.target-hint'), target);

  // Test connection: lists the models, which also checks the address and key; no subtitle is sent.
  const testMessage = h('p', { class: 'provider-message', role: 'status' });
  const test = h('button', { class: 'button' }, t('subtrans.settings.test'));
  test.addEventListener('click', () => void listModels());
  const testRow = h('div', {}, row(t('subtrans.settings.test'), t('subtrans.settings.test-hint'), test), testMessage);

  async function listModels(): Promise<string[] | null> {
    const provider = prefs.provider;
    const gen = generation;
    test.disabled = true;
    testMessage.textContent = t('subtrans.settings.testing');
    try {
      const models = await invoke<string[]>('subtrans_models', { config: configOf(prefs) });
      listed = { provider, models };
      if (stillShown(provider, gen)) testMessage.textContent = t('subtrans.settings.test-ok', { count: models.length });
      return models;
    } catch (err) {
      if (stillShown(provider, gen)) testMessage.textContent = errorMessage(err) ?? '';
      return null;
    } finally {
      test.disabled = false;
    }
  }

  /** The rows that depend on the service chosen. */
  function drawProvider(): void {
    generation++;
    const gen = generation;
    // No controls bound to the earlier service stay usable while this one's key is looked up.
    keyControl.replaceChildren();
    const local = prefs.provider === 'local';
    serverRow.hidden = !local || !enabled;
    keyRow.hidden = local || !enabled;
    model.value = prefs.models[prefs.provider];
    testMessage.textContent = '';
    keyMessage.textContent = '';
    if (!local) {
      const provider = prefs.provider;
      void invoke<boolean>('subtrans_key_saved', { provider })
        .then((saved) => stillShown(provider, gen) && (saved ? showKeySaved(provider) : showKeyEmpty(provider)))
        .catch(() => stillShown(provider, gen) && showKeyEmpty(provider));
    }
  }

  const dependents = [providerRow, serverRow, keyRow, modelRow, targetRow, testRow];
  const toggle = createSwitch('', enabled, (on) => {
    enabled = on;
    showDependents(enabledRow, dependents, on);
    drawProvider();
    void save(AI_SUBS_ENABLED_KEY, on);
  });
  toggle.setAttribute('aria-label', t('subtrans.settings.enabled'));
  const enabledRow = row(t('subtrans.settings.enabled'), t('subtrans.settings.enabled-hint'), toggle);
  showDependents(enabledRow, dependents, enabled);
  drawProvider();

  return [
    h('h3', { class: 'settings-subheading appearance-section' }, t('subtrans.settings.heading')),
    h('p', { class: 'muted settings-intro' }, t('subtrans.settings.intro'), ' ', t('subtrans.settings.privacy-services')),
    enabledRow,
    ...dependents,
  ];
}
