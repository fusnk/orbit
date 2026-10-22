/**
 * The profile editor's "Content limit" section, and the prompt for a
 * parent's PIN. Who may change a limit is decided in Rust (profiles.rs):
 * tightening needs only the right to edit the profile; loosening or removing
 * one needs a parent, i.e. a profile without a limit that has a PIN, by being
 * the active profile or by typing its PIN here.
 */
import { regionName, streamingRegion } from '../../catalog/streaming';
import { changeLevel, LEVELS, type ContentLimit, type Level } from '../../catalog/ratings';
import { tmdbConnected } from '../../catalog/tmdb';
import { createSwitch } from '../../components/switch';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { PARENT_PIN_NEEDED, setContentLimit, type Profile } from '../../library/profiles';
import { errorText } from '../../components/state-message';

export const LEVEL_LABELS: Record<Level, MessageKey> = {
  off: 'parental.level.off',
  kids: 'parental.level.kids',
  'older-kids': 'parental.level.older-kids',
  teens: 'parental.level.teens',
  'no-adult': 'parental.level.no-adult',
};

const ABOUT: Record<Level, MessageKey> = {
  off: 'parental.about.off',
  kids: 'parental.about.kids',
  'older-kids': 'parental.about.older-kids',
  teens: 'parental.about.teens',
  'no-adult': 'parental.about.no-adult',
};

/** The picker's four-dot PIN field (see picker.ts). */
export type PinField = (label: string, onComplete: (pin: string) => Promise<void>, onCancel: () => void) => { element: HTMLElement; input: HTMLInputElement };

/** Whether an error from profiles.rs asks for a parent's PIN. */
export const needsParentPin = (err: unknown) => String(err) === PARENT_PIN_NEEDED;

/**
 * Asks for a parent's PIN: `note` says why, `onPin` tries it (a rejection
 * shows its message and clears the dots), Escape calls `onCancel`. The field
 * is focused at once: the person asked for the change that needs it.
 */
export function parentPinPrompt(pinField: PinField, note: string, onPin: (pin: string) => Promise<void>, onCancel: () => void): HTMLElement {
  const pin = pinField(t('parental.parent-pin'), onPin, onCancel);
  const prompt = h('div', { class: 'who-section parental-pin' }, h('span', { class: 'who-section-label' }, t('parental.parent-pin')), h('p', { class: 'muted' }, note), pin.element);
  requestAnimationFrame(() => pin.input.focus({ preventScroll: true }));
  return prompt;
}

const note = (key: MessageKey, values?: Record<string, string>) => h('p', { class: 'muted' }, t(key, values));

/** The limit section for `profile`; `changed` is called after the limit was saved. */
export function limitSection(profile: Profile, profiles: readonly Profile[], deps: { pinField: PinField; changed: () => void }): HTMLElement {
  const section = h('div', { class: 'who-section limit-section' });
  const message = h('p', { class: 'pin-message', role: 'alert' });
  const tmdbNote = note('parental.needs-tmdb');
  tmdbNote.hidden = true;
  const regionNote = h('p', { class: 'muted' });
  /** Without TMDB unrated titles stay hidden whatever the switch says (catalog/parental.ts), and its note says so. */
  let tmdbOn = true;
  const unratedNote = h('p', { class: 'muted' });
  const sayUnrated = () => (unratedNote.textContent = t(profile.contentLimit.allowUnrated && tmdbOn ? 'parental.unrated-shown' : 'parental.unrated-hidden'));
  void tmdbConnected().then((on) => {
    tmdbOn = on;
    tmdbNote.hidden = on;
    sayUnrated();
  });
  void streamingRegion().then((code) => (regionNote.textContent = t('parental.region', { country: regionName(code) })));

  /** Saves `next`, then draws the section again with focus back on what was pressed (`focusKey`). */
  async function apply(next: ContentLimit, focusKey: string, pin?: string): Promise<void> {
    await setContentLimit(profile.id, next, pin);
    profile.contentLimit = next;
    deps.changed();
    draw(focusKey);
  }

  function change(next: ContentLimit, focusKey: string): void {
    message.textContent = '';
    apply(next, focusKey).catch((err: unknown) => {
      if (!needsParentPin(err)) {
        draw(focusKey);
        message.textContent = errorText(err);
        return;
      }
      section.replaceChildren(
        parentPinPrompt(deps.pinField, t('parental.parent-pin-prompt'), (pin) => apply(next, focusKey, pin), () => draw(focusKey)),
      );
    });
  }

  function draw(focusKey?: string): void {
    const limit = profile.contentLimit;
    const segments = LEVELS.map((level) => {
      const segment = h('button', { class: 'segment', 'aria-pressed': String(level === limit.level), 'data-limit': level }, t(LEVEL_LABELS[level]));
      // A new level starts from its own defaults for unrated titles and Live TV, keeping what was turned off when it's stricter.
      segment.addEventListener('click', () => level !== limit.level && change(changeLevel(limit, level), level));
      return segment;
    });
    const parts: (HTMLElement | string)[] = [
      h('span', { class: 'who-section-label' }, t('parental.heading')),
      h('div', { class: 'segments', role: 'group', 'aria-label': t('parental.heading') }, ...segments),
      note(ABOUT[limit.level]),
    ];
    if (limit.level !== 'off') {
      const unrated = createSwitch(t('parental.unrated'), limit.allowUnrated, (on) => change({ ...limit, allowUnrated: on }, 'unrated'));
      unrated.dataset.limit = 'unrated';
      sayUnrated();
      const live = createSwitch(t('parental.live-tv'), limit.allowLiveTv, (on) => change({ ...limit, allowLiveTv: on }, 'live'));
      live.dataset.limit = 'live';
      const parents = profiles.filter((p) => p.contentLimit.level === 'off' && p.hasPin);
      const open = profiles.filter((p) => p.id !== profile.id && p.contentLimit.level === 'off' && !p.hasPin);
      parts.push(
        unrated,
        unratedNote,
        live,
        note('parental.live-tv-hint'),
        note('parental.addons-note'),
        regionNote,
        tmdbNote,
        // A limit is only as strong as a parent's PIN: say plainly where it isn't.
        parents.length ? note('parental.who-changes') : h('p', { class: 'muted parental-warning' }, t('parental.no-parent')),
        open.length ? h('p', { class: 'muted parental-warning' }, t('parental.open-profiles', { names: open.map((p) => p.name).join(', ') })) : '',
      );
    }
    parts.push(message);
    section.replaceChildren(...parts);
    if (focusKey) section.querySelector<HTMLElement>(`[data-limit="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  draw();
  return section;
}
