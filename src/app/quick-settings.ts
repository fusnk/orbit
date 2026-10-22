/**
 * Quick settings: the title bar's sliders button opens a small panel with the
 * choices people reach for most (pause watch history, the Look, card shape, autoplay,
 * trailers, skipping intros, effects) so they needn't open all of Settings. Every
 * control writes through the setting's own setter, the same one Settings
 * uses. Like the bell's panel it's a modal layer: the app behind is inert and
 * dimmed, arrow keys stay inside (spatial nav), and Back, Esc or a click
 * outside closes it. Focus lands on a control but never changes it; Enter,
 * a click or a controller's A does.
 */
import './quick-settings.css';
import { onBack } from './back';
import { reportError } from './errors';
import { icon } from '../components/icons';
import { pushLayer } from '../components/layers';
import { placeMenu } from '../components/menu';
import { toast } from '../components/toast';
import { isRtl, t } from '../i18n';
import { h } from '../lib/dom';
import { settings } from '../lib/ipc';
import { historyPaused, onHistoryPauseChange, setHistoryPaused } from '../library/history-pause';
import { activeProfileId, listProfiles } from '../library/profiles';
import { BANNER_TRAILER_KEY, HERO_TRAILER_KEY } from '../rooms/detail/trailer-settings';
import { parseAutoplayMode, PLAYBACK_SETTINGS, type AutoplayMode } from '../rooms/player/next-up';
import { loadPlayerLayout } from '../rooms/player/layout';
import { parseSkipModes, SKIP_MODES_KEY } from '../rooms/player/skip';
import { avatar, openProfileSwitcher } from '../rooms/profiles/picker';
import { lookMiniature } from '../rooms/settings/looks';
import { choices, pressChoice, save } from '../rooms/settings/playback';
import { appearance, effectsReduced, ROW_STYLE_CHANGED, setAppearance, type CardShape } from '../theme/appearance';
import { autoReason, effectsSwitchValue } from '../theme/auto-effects';
import { activeLook, applyLook, LOOKS } from '../theme/looks';
import { skipIntrosOn, trailerState, withSkipIntros } from './quick-state';
import { errorText } from '../components/state-message';
import { connectState, startConnect, stopConnect } from './connect-state';
import { remoteStatus, startRemote, stopRemote } from './remote-status';

function failed(err: unknown): void {
  console.error('Could not save setting', err);
  toast(t('settings.common.save-failed'));
}

/** Turns pausing on or off and says so (from here or Ctrl+K). */
export function toggleHistoryPause(): Promise<void> {
  const on = !historyPaused();
  return setHistoryPaused(on).then(() => toast(t(on ? 'quick.paused' : 'quick.resumed')), failed);
}

/** The title-bar chip shown while watch history is paused; pressing it opens Quick settings. */
export function createHistoryChip(open: (anchor: HTMLElement) => void): HTMLElement {
  const chip = h('button', { class: 'history-chip', title: t('quick.chip-label'), 'aria-label': t('quick.chip-label') }, icon('pause', { filled: true }), h('span', {}, t('quick.chip')));
  chip.addEventListener('click', () => open(chip));
  const sync = () => (chip.hidden = !historyPaused());
  onHistoryPauseChange(sync);
  sync();
  return chip;
}

/**
 * An on/off row with the shared switch's look. Unlike `createSwitch` it
 * reads its state back after saving, so a failed save shows what's true.
 */
function toggle(label: string, isOn: () => boolean, change: (on: boolean) => Promise<unknown>): HTMLButtonElement {
  const button = h('button', { class: 'switch wide quick-switch', role: 'switch' }, h('span', { class: 'switch-label' }, label), h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' })));
  const sync = () => button.setAttribute('aria-checked', String(isOn()));
  button.addEventListener('click', () => {
    const next = !isOn();
    button.setAttribute('aria-checked', String(next));
    void change(next).catch(failed).finally(sync);
  });
  sync();
  return button;
}

/** Header: who's watching, and the way to switch. Filled in once the profile is read. */
function profileHead(close: () => void): HTMLElement {
  const head = h('div', { class: 'quick-head' });
  void Promise.all([listProfiles(), activeProfileId()])
    .then(([profiles, id]) => {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return;
      const swap = h('button', { class: 'quick-link' }, icon('swap'), t('quick.switch-profile'));
      swap.addEventListener('click', () => {
        close();
        void openProfileSwitcher().catch((err: unknown) => reportError('Could not open the profile switcher', err));
      });
      head.replaceChildren(avatar(profile), h('span', { class: 'quick-name' }, profile.name), swap);
    })
    .catch((err: unknown) => console.warn('Could not read the profile', err));
  return head;
}

/** A small picture of each Look (its theme's colours, where its menu sits, its banner) with its name; the one on screen is pressed. */
function looksRow(): HTMLElement {
  const caption = h('span', { class: 'quick-caption' });
  const swatches = h('div', { class: 'quick-looks', role: 'group', 'aria-label': t('quick.look') });
  let busy = false;
  const draw = async () => {
    const active = activeLook(await loadPlayerLayout());
    caption.textContent = active ? active.name : t('quick.look-custom');
    const focused = swatches.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.look : undefined;
    swatches.replaceChildren(
      ...LOOKS.map((look) => {
        const swatch = h('span', { class: 'quick-look-swatch', 'aria-hidden': 'true' }, lookMiniature(look));
        const button = h('button', { class: 'quick-look', 'aria-pressed': String(look === active), 'data-look': look.id, disabled: busy }, swatch, h('span', { class: 'quick-look-name' }, look.name));
        button.addEventListener('click', () => {
          if (look === active || busy) return;
          busy = true;
          void applyLook(look.id)
            .then(() => toast(t('looks.applied', { name: look.name })), failed)
            .finally(() => {
              busy = false;
              void draw();
            });
        });
        return button;
      }),
    );
    if (focused) swatches.querySelector<HTMLElement>(`[data-look="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  void draw().catch((err: unknown) => console.warn('Could not show the Looks', err));
  return h('div', { class: 'quick-section' }, h('div', { class: 'quick-label' }, h('span', {}, t('quick.look')), caption), swatches);
}

/**
 * Card shape: Portrait or Landscape (Settings → Appearance → Posters), saved
 * through the same setter. A Look picked above can change it, so it follows
 * the setting until `stop`.
 */
function cardShapeRow(): { element: HTMLElement; stop: () => void } {
  const options: readonly (readonly [CardShape, string])[] = [
    ['poster', t('settings.appearance.card-shape-portrait')],
    ['landscape', t('settings.appearance.card-shape-landscape')],
  ];
  const control = choices(t('settings.appearance.card-shape'), options, appearance().rowStyle, (rowStyle) => void setAppearance({ rowStyle }).catch(failed));
  control.classList.add('quick-segments');
  const sync = () => pressChoice(control, options, appearance().rowStyle);
  document.addEventListener(ROW_STYLE_CHANGED, sync);
  return {
    element: h('div', { class: 'quick-section' }, h('div', { class: 'quick-label' }, h('span', {}, t('settings.appearance.card-shape'))), control),
    stop: () => document.removeEventListener(ROW_STYLE_CHANGED, sync),
  };
}

/** Autoplay next episode: Always, Ask or Never (Settings → Playback). */
function autoplayRow(): HTMLElement {
  const section = h('div', { class: 'quick-section' }, h('div', { class: 'quick-label' }, h('span', {}, t('settings.playback.autoplay'))));
  void settings
    .get(PLAYBACK_SETTINGS.autoplay)
    .catch(() => null)
    .then((saved) => {
      const options: readonly (readonly [AutoplayMode, string])[] = [
        ['always', t('watching.autoplay.always')],
        ['ask', t('watching.autoplay.ask')],
        ['never', t('watching.autoplay.never')],
      ];
      const control = choices(t('settings.playback.autoplay'), options, parseAutoplayMode(saved), (mode) => void save(PLAYBACK_SETTINGS.autoplay, mode));
      control.classList.add('quick-segments');
      section.append(control);
    });
  return section;
}

/**
 * Autoplay trailers: one switch for both of Settings → Playback's trailer
 * settings (title pages and banners). It's on only when both are; when just
 * one is, a line says so, and turning it on turns on both.
 */
function trailersToggle(): HTMLElement[] {
  let on = false;
  const partly = h('p', { class: 'quick-hint quick-sub-hint', hidden: true }, t('quick.trailers-partly'));
  const button = toggle(t('quick.trailers'), () => on, async (next) => {
    await Promise.all([settings.set(HERO_TRAILER_KEY, next), settings.set(BANNER_TRAILER_KEY, next)]);
    on = next;
    partly.hidden = true;
  });
  void Promise.all([settings.get(HERO_TRAILER_KEY), settings.get(BANNER_TRAILER_KEY)])
    .then(([hero, banner]) => {
      const state = trailerState(hero, banner);
      on = state === 'on';
      button.setAttribute('aria-checked', String(on));
      partly.hidden = state !== 'mixed';
    })
    .catch(() => {});
  return [button, partly];
}

/** Skip intros automatically: intros and recaps skipped without asking, or with a Skip button (Settings → Playback → Skipping). */
function skipIntrosToggle(): HTMLElement {
  let modes = parseSkipModes(null, false);
  const button = toggle(t('quick.skip-intros'), () => skipIntrosOn(modes), async (next) => {
    const changed = withSkipIntros(modes, next);
    await settings.set(SKIP_MODES_KEY, changed);
    modes = changed;
  });
  void Promise.all([settings.get(SKIP_MODES_KEY), settings.get(PLAYBACK_SETTINGS.autoSkip)])
    .then(([saved, autoSkip]) => {
      modes = parseSkipModes(saved, autoSkip);
      button.setAttribute('aria-checked', String(skipIntrosOn(modes)));
    })
    .catch(() => {});
  return button;
}

/**
 * Phone remote: on turns it on and shows its pairing code in Settings (the
 * QR code needs the room); off turns it off.
 */
function phoneRemoteToggle(showPairing: () => void): HTMLElement {
  let on = false;
  const button = toggle(t('remote.palette'), () => on, async (next) => {
    if (next) {
      try {
        await startRemote();
      } catch (err) {
        // Its own words (no home network, say), not "couldn't save".
        return toast(errorText(err, { fallback: 'remote.settings.failed' }));
      }
      on = true;
      showPairing();
    } else {
      await stopRemote();
      on = false;
    }
  });
  void remoteStatus()
    .then((status) => {
      on = status.running;
      button.setAttribute('aria-checked', String(on));
    })
    .catch(() => {});
  return button;
}

/**
 * Orbit Connect: on turns it on and shows its part of Settings (to pair a
 * device, or see the devices there are); off turns it off.
 */
function connectToggle(showDevices: () => void): HTMLElement {
  let on = connectState().running;
  const button = toggle(t('connect.palette'), () => on, async (next) => {
    if (next) {
      try {
        await startConnect();
      } catch (err) {
        return toast(errorText(err, { fallback: 'connect.failed' }));
      }
      on = true;
      showDevices();
    } else {
      await stopConnect();
      on = false;
    }
  });
  return button;
}

/** Opens Quick settings under `anchor`. `allSettings` goes to the full Settings page, `addons` to the Addons page, `tonight` opens Tonight, `phoneRemote` Settings' phone remote section, `connect` its Orbit Connect section. */
export function openQuickSettings(anchor: HTMLElement, allSettings: () => void, addons: () => void, tonight: () => void, phoneRemote: () => void, connect: () => void): void {
  const returnFocus = document.activeElement;

  const pause = toggle(t('quick.pause-history'), historyPaused, (on) => setHistoryPaused(on).then(() => toast(t(on ? 'quick.paused' : 'quick.resumed'))));
  const stopPauseSync = onHistoryPauseChange(() => pause.setAttribute('aria-checked', String(historyPaused())));

  const effects = toggle(
    t('settings.appearance.effects'),
    () => effectsReduced(),
    // Off goes back to Auto where Auto keeps the full look anyway, so the low-end detection isn't lost for good.
    (on) => setAppearance({ effects: effectsSwitchValue(on, autoReason() !== null) }),
  );

  const more = h('button', { class: 'quick-all' }, icon('sliders'), t('quick.all-settings'));
  more.addEventListener('click', () => {
    close();
    allSettings();
  });
  const addonsPage = h('button', { class: 'quick-all' }, icon('addons'), t('addonspage.nav'));
  addonsPage.addEventListener('click', () => {
    close();
    addons();
  });

  const tonightButton = h('button', { class: 'quick-all' }, icon('moon'), t('tonight.open'));
  tonightButton.addEventListener('click', () => {
    close();
    tonight();
  });

  const cardShape = cardShapeRow();

  const scrim = h('div', { class: 'quick-scrim', 'aria-hidden': 'true' });
  const panel = h(
    'div',
    { class: 'quick-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('quick.heading'), tabindex: '-1' },
    profileHead(() => close()),
    h('div', { class: 'quick-section quick-history' }, pause, h('p', { class: 'quick-hint' }, t('quick.pause-history-hint'))),
    looksRow(),
    cardShape.element,
    autoplayRow(),
    h(
      'div',
      { class: 'quick-section quick-toggles' },
      ...trailersToggle(),
      skipIntrosToggle(),
      effects,
      phoneRemoteToggle(() => {
        close();
        phoneRemote();
      }),
      connectToggle(() => {
        close();
        connect();
      }),
    ),
    h('div', { class: 'quick-foot' }, tonightButton, addonsPage, more),
  );

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    removeBack();
    removeLayer();
    stopPauseSync();
    cardShape.stop();
    document.removeEventListener('pointerdown', onOutside, true);
    resized.disconnect();
    panel.remove();
    scrim.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  const removeBack = onBack(close);
  const onOutside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node)) close();
  };
  document.addEventListener('pointerdown', onOutside, true);

  document.body.append(scrim, panel);
  const place = () => {
    const button = anchor.getBoundingClientRect();
    // It scrolls in the room beside its button (under it, or over it when that's bigger) rather than climbing over
    // the button and the window's own buttons, which a click then can't reach. Only a window too short for a few
    // rows lets it take the whole height.
    const room = Math.max(innerHeight - button.bottom, button.top) - 16;
    panel.style.maxHeight = room >= 240 ? `${room}px` : '';
    const { width, height } = panel.getBoundingClientRect();
    const at = placeMenu(button, 8, { width, height }, { width: innerWidth, height: innerHeight }, isRtl());
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
  };
  place();
  // The rows filled in later (profile, autoplay) change its height.
  const resized = new ResizeObserver(place);
  resized.observe(panel);
  anchor.setAttribute('aria-expanded', 'true');
  const removeLayer = pushLayer(panel, close);
  pause.focus({ preventScroll: true });
}
