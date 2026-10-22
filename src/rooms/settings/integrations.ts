/**
 * Settings → Accounts & Services: services that use the person's own key,
 * then Live TV's sources (live-tv.ts, as they were). Keys go to Rust, which
 * checks them with the service and keeps them in the OS keychain; the page
 * can only learn whether one is saved.
 */
import { invoke } from '@tauri-apps/api/core';
import { connectLetterboxd, disconnectLetterboxd, letterboxdProfile } from '../../catalog/letterboxd';
import { pickedServices, regionChoices, regionName, setPickedServices, setStreamingRegion, streamingRegion } from '../../catalog/streaming';
import { noteTmdbChanged, streamingServices } from '../../catalog/tmdb';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { serviceLogo } from '../../components/service-logo';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { activityOptionsChanged, setActivityEnabled } from '../../app/activity';
import { discordOptions, setDiscordOptions, setHideOnLimited, type DiscordOptions, type DiscordTime } from '../../app/discord-options';
import { DISCORD_KEY } from '../player/presence';
import { debridSection } from './debrid';
import { choices, row, save } from './playback';
import { jellyfinSection } from './jellyfin';
import { plexSection } from './plex';
import { stremioSection } from './stremio';
import { anilistSection } from './anilist';
import { showDependents } from './dependent-rows';
import { liveTvPanel } from './live-tv';
import { keyField } from './typed-keys';
import { errorText } from '../../components/state-message';
import { isAndroid } from '../../lib/platform';
import { needsParentPin, parentPinPrompt } from '../profiles/content-limit';
import { pinField } from '../profiles/picker';

export function integrationsPanel(): HTMLElement {
  const streaming = streamingSection();
  return h(
    'div',
    {},
    h('h3', { class: 'settings-subheading' }, t('integrations.providers.heading')),
    h('p', { class: 'muted settings-intro' }, t(isAndroid ? 'integrations.providers.intro-android' : 'integrations.providers.intro')),
    tmdbRow(streaming.refresh),
    streaming.element,
    stremioSection(),
    anilistSection(),
    jellyfinSection(),
    plexSection(),
    debridSection(),
    letterboxdSection(),
    // Discord's desktop app is what shows Rich Presence; Android has none to talk to.
    ...(isAndroid ? [] : [discordSection()]),
    h('div', { class: 'live-tv-section' }, h('h3', { class: 'settings-subheading' }, t('settings.nav.livetv')), liveTvPanel()),
  );
}

/** Letterboxd rows on Home, from a public profile: just the username, no login. */
function letterboxdSection(): HTMLElement {
  const control = h('div', { class: 'provider-key' });
  const message = h('p', { class: 'provider-message', role: 'status' });

  function showConnected(name: string, user: string): void {
    const remove = h('button', { class: 'button danger' }, t('integrations.common.disconnect'));
    remove.addEventListener('click', () => {
      void disconnectLetterboxd()
        .then(() => {
          const hadFocus = control.contains(document.activeElement);
          message.textContent = '';
          showEmpty();
          // Disconnect replaced itself: focus goes on to the username field rather than the page.
          if (hadFocus) control.querySelector<HTMLElement>('input')?.focus();
        })
        .catch((err: unknown) => (message.textContent = errorText(err, { action: true })));
    });
    control.replaceChildren(h('span', { class: 'provider-status' }, `${name} (@${user})`), remove);
  }

  function showEmpty(): void {
    const field = createTextField({ label: t('integrations.letterboxd.field-label'), placeholder: t('integrations.letterboxd.field-placeholder'), onSubmit: () => void connect() });
    const button = h('button', { class: 'button primary' }, t('integrations.common.connect'));
    button.addEventListener('click', () => void connect());
    // A flag rather than `disabled` while Letterboxd is asked: disabling the focused button would drop focus to the page.
    let finding = false;
    async function connect(): Promise<void> {
      if (finding || !field.value.trim()) return;
      finding = true;
      button.setAttribute('aria-busy', 'true');
      message.textContent = t('integrations.letterboxd.finding');
      try {
        const profile = await connectLetterboxd(field.value);
        const hadFocus = control.contains(document.activeElement);
        message.textContent = t('integrations.letterboxd.connected');
        showConnected(profile.name, profile.user);
        // The field and Connect are gone: focus goes to Disconnect rather than the page.
        if (hadFocus) control.querySelector<HTMLElement>('button')?.focus();
      } catch (err) {
        message.textContent = errorText(err, { action: true });
        finding = false;
        button.removeAttribute('aria-busy');
      }
    }
    control.replaceChildren(field, button);
  }

  void letterboxdProfile().then((profile) => (profile ? showConnected(profile.name, profile.user) : showEmpty()));
  return h(
    'div',
    { class: 'letterboxd-section' },
    h('h3', { class: 'settings-subheading' }, 'Letterboxd'),
    row(
      t('integrations.letterboxd.profile'),
      t('integrations.letterboxd.profile-hint'),
      control,
    ),
    message,
  );
}

/** Rich Presence: "Watching <title>" on the person's Discord profile. */
function discordSection(): HTMLElement {
  const body = h('div', {});
  void settings.get(DISCORD_KEY).catch(() => null).then((on) => {
    const options = discordOptions();
    const change = (update: Partial<DiscordOptions>) => {
      void setDiscordOptions(update)
        .then(activityOptionsChanged)
        .catch((err: unknown) => console.warn('Could not save the Discord options', err));
    };
    const option = (key: 'hideTitle' | 'whilePaused' | 'whileBrowsing' | 'poster', label: MessageKey, hint: MessageKey) => {
      const control = createSwitch('', options[key], (value) => change({ [key]: value }));
      control.setAttribute('aria-label', t(label));
      return row(t(label), t(hint), control);
    };
    // On a limited profile, turning this off needs a parent's PIN, as loosening the limit does (Rust checks it).
    const hideOnLimited = () => {
      const prompt = h('div');
      const control = createSwitch('', options.hideOnLimited, (value) => {
        const apply = (pin?: string) =>
          setHideOnLimited(value, pin).then(() => {
            prompt.replaceChildren();
            activityOptionsChanged();
          });
        const back = () => {
          prompt.replaceChildren();
          control.setAttribute('aria-checked', 'true');
        };
        void apply().catch((err: unknown) => {
          if (!needsParentPin(err)) {
            back();
            return console.warn('Could not save the Discord options', err);
          }
          prompt.replaceChildren(
            parentPinPrompt(pinField, t('parental.parent-pin-prompt'), apply, () => {
              back();
              control.focus({ preventScroll: true });
            }),
          );
        });
      });
      control.setAttribute('aria-label', t('integrations.discord.hide-limited'));
      return h('div', {}, row(t('integrations.discord.hide-limited'), t('integrations.discord.hide-limited-hint'), control), prompt);
    };
    const times: (readonly [DiscordTime, string])[] = [
      ['progress', t('integrations.discord.time.progress')],
      ['elapsed', t('integrations.discord.time.elapsed')],
      ['off', t('integrations.discord.time.off')],
    ];
    // The finer options only matter while sharing is on.
    const more = h(
      'div',
      { class: 'discord-options', hidden: on !== true },
      option('hideTitle', 'integrations.discord.hide-title', 'integrations.discord.hide-title-hint'),
      option('poster', 'integrations.discord.poster', 'integrations.discord.poster-hint'),
      row(t('integrations.discord.time'), t('integrations.discord.time-hint'), choices(t('integrations.discord.time'), times, options.time, (time) => change({ time }))),
      option('whilePaused', 'integrations.discord.while-paused', 'integrations.discord.while-paused-hint'),
      option('whileBrowsing', 'integrations.discord.while-browsing', 'integrations.discord.while-browsing-hint'),
      hideOnLimited(),
    );
    const toggle = createSwitch('', on === true, (value) => {
      setActivityEnabled(value);
      showDependents(showRow, [more], value);
      void save(DISCORD_KEY, value);
    });
    toggle.setAttribute('aria-label', t('integrations.discord.show-label'));
    const showRow = row(t('integrations.discord.show'), t('integrations.discord.show-hint'), toggle);
    showDependents(showRow, [more], on === true);
    body.replaceChildren(showRow, more);
  });
  return h('div', { class: 'discord-section' }, h('h3', { class: 'settings-subheading' }, 'Discord'), body);
}

/** Streaming services to show "Popular on …" rows for on Home (needs TMDB). */
function streamingSection(): { element: HTMLElement; refresh(): void } {
  const body = h('div', {});
  const element = h(
    'div',
    { class: 'streaming-section' },
    h('h3', { class: 'settings-subheading' }, t('integrations.streaming.heading')),
    h('p', { class: 'muted settings-intro' }, t('integrations.streaming.intro')),
    body,
  );
  let generation = 0;

  async function refresh(): Promise<void> {
    const current = ++generation;
    const [services, picked, region] = await Promise.all([streamingServices().catch(() => null), pickedServices(), streamingRegion()]);
    if (current !== generation) return;
    if (!services) return void body.replaceChildren(h('p', { class: 'muted' }, t('integrations.streaming.needs-tmdb')));
    const chosen = new Set(picked);

    const regionButton = h('button', { class: 'button' }, regionName(region), icon('chevronDown'));
    const parentPin = h('div');
    const pick = (code: string, guardianPin?: string) => setStreamingRegion(code, guardianPin).then(refresh);
    regionButton.addEventListener('click', () =>
      openMenuFrom(
        regionButton,
        regionChoices().map((code) => ({
          label: regionName(code),
          action: () =>
            void pick(code).catch((err: unknown) => {
              // A content limit reads ratings in the region's terms: on a limited profile, changing it needs a parent's PIN (Rust checks it).
              if (needsParentPin(err)) parentPin.replaceChildren(parentPinPrompt(pinField, t('parental.parent-pin-prompt'), (pin) => pick(code, pin), () => parentPin.replaceChildren()));
              else failed(err);
            }),
        })),
      ),
    );
    const tiles = services.map((service) => {
      const tile = h(
        'button',
        { class: 'service-tile', 'aria-pressed': String(chosen.has(service.key)) },
        serviceLogo(service, true),
        h('span', {}, service.name),
      );
      tile.addEventListener('click', () => {
        if (!chosen.delete(service.key)) chosen.add(service.key);
        tile.setAttribute('aria-pressed', String(chosen.has(service.key)));
        // Saved in the services' own order, which is the order of the rows on Home.
        setPickedServices(services.filter((s) => chosen.has(s.key)).map((s) => s.key)).catch(failed);
      });
      return tile;
    });
    body.replaceChildren(row(t('integrations.streaming.country'), t('integrations.streaming.country-hint'), regionButton), parentPin, h('div', { class: 'service-grid', role: 'group', 'aria-label': t('integrations.streaming.heading') }, ...tiles));
  }

  void refresh();
  return { element, refresh: () => void refresh() };
}

function failed(err: unknown): void {
  console.error('Could not save setting', err);
  toast(t('integrations.common.save-failed'));
}

/** `onChange` runs after the token is saved or removed. */
export function tmdbRow(onChange: () => void): HTMLElement {
  const control = h('div', { class: 'provider-key' });
  const message = h('p', { class: 'provider-message', role: 'status' });
  // `tmdb-row`: where hints elsewhere ("Add a TMDB key…") open Settings to.
  const element = h(
    'div',
    { class: 'tmdb-row' },
    row('TMDB', t('integrations.tmdb.hint'), control),
    message,
  );

  function showSaved(): void {
    const remove = h('button', { class: 'button danger' }, t('integrations.common.remove'));
    const clear = async (guardianPin?: string) => {
      await invoke('tmdb_clear_token', { guardianPin: guardianPin ?? null });
      message.textContent = t('integrations.tmdb.removed');
      showEmpty();
      noteTmdbChanged();
      onChange();
    };
    remove.addEventListener('click', () => {
      void clear().catch((err: unknown) => {
        // Without TMDB every title is unrated: on a profile with a content limit, removing it needs a parent's PIN (Rust checks it).
        if (needsParentPin(err)) control.replaceChildren(parentPinPrompt(pinField, t('parental.parent-pin-prompt'), clear, showSaved));
        else message.textContent = errorText(err, { action: true });
      });
    });
    control.replaceChildren(h('span', { class: 'provider-status' }, t('integrations.common.connected')), remove);
  }

  function showEmpty(): void {
    const field = createTextField({ label: t('integrations.tmdb.field-label'), placeholder: t('integrations.tmdb.field-placeholder'), onSubmit: () => void save() });
    field.type = 'password';
    const saveButton = h('button', { class: 'button primary' }, t('integrations.common.save'));
    saveButton.addEventListener('click', () => void save());
    keyField(field, save);
    async function save(): Promise<boolean> {
      if (!field.value.trim()) return false;
      saveButton.disabled = true;
      message.textContent = t('integrations.tmdb.checking');
      try {
        await invoke('tmdb_set_token', { token: field.value });
        message.textContent = t('integrations.tmdb.connected');
        showSaved();
        noteTmdbChanged();
        onChange();
        return true;
      } catch (err) {
        message.textContent = errorText(err, { action: true });
        saveButton.disabled = false;
        return false;
      }
    }
    control.replaceChildren(field, saveButton);
  }

  void invoke<boolean>('tmdb_token_saved')
    .then((saved) => (saved ? showSaved() : showEmpty()))
    .catch(() => showEmpty());
  return element;
}
