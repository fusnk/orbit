/**
 * Settings → Appearance → Looks: a card per Look (theme/looks.ts) with a
 * miniature of it (its theme's colours, where the menu sits and the banner's
 * shape), the active one pressed, and while a Look is on, "Restore my previous
 * setup". Changing a bundled setting elsewhere redraws the cards, so a Look no
 * longer matched shows as custom.
 */
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { SETTING_SAVED } from '../../lib/ipc';
import { loadPlayerLayout, PLAYER_LAYOUT_KEY } from '../player/layout';
import { activeLook, applyLook, lookBackup, LOOKS, restoreLook, type LookId, type LookPreset } from '../../theme/looks';
import { COLOR_KEYS, findPreset } from '../../theme/palette';
import { row } from './playback';

const HINTS: Record<LookId, MessageKey> = {
  orbit: 'looks.orbit-hint',
  crimson: 'looks.crimson-hint',
  marquee: 'lookstyles.marquee-hint',
  premiere: 'lookstyles.premiere-hint',
  glass: 'lookstyles.glass-hint',
  aurora: 'lookstyles.aurora-hint',
  couch: 'lookstyles.couch-hint',
  afterglow: 'lookstyles.afterglow-hint',
  arc: 'orbitlook.look-hint',
};

/** Settings whose change can make the Look on screen another one, or none. */
const WATCHED = new Set(['theme', 'theme.accent', 'theme.fonts', 'appearance', 'theme.layout', PLAYER_LAYOUT_KEY]);

/** A small window in the Look's colours: its nav where the Look puts it, its banner's shape, posters (also Quick settings' swatches). */
export function lookMiniature(look: LookPreset): HTMLElement {
  const colors = findPreset(look.theme)?.colors;
  const box = h(
    'span',
    { class: 'look-mini', 'aria-hidden': 'true', 'data-nav': look.nav.position, 'data-nav-align': look.nav.align, 'data-hero': look.appearance.heroStyle, 'data-corners': look.appearance.corners },
    h('span', { class: 'look-mini-nav' }, h('span', {}), h('span', {}), h('span', {})),
    h('span', { class: 'look-mini-hero' }, h('span', { class: 'look-mini-logo' })),
    h('span', { class: 'look-mini-posters' }, h('span', {}), h('span', {}), h('span', {}), h('span', {})),
  );
  if (colors) for (const key of COLOR_KEYS) box.style.setProperty(`--mini-${key}`, colors[key]);
  return box;
}

/** The latest generation of each owner's section (Settings', first-run setup's), so one's redraw doesn't retire the other's listener. */
const generations = new Map<LooksOwner, number>();
/** What was focused in a Looks section when the Look it applied was done, for the section the page draws next. */
let refocus: string | null = null;

const focusedText = (section: HTMLElement): string | null => (document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? document.activeElement.textContent : null);

/** Who shows the section: each keeps one live section, the newest it drew. */
export type LooksOwner = 'settings' | 'onboarding';

/** `onChanged` runs after a Look is applied or the previous setup restored, so the rest of the page can redraw. */
export function looksSection(owner: LooksOwner, onChanged: () => void): HTMLElement {
  const section = h('div', { class: 'looks-section' });
  let busy = false;

  const failed = (err: unknown) => {
    console.error('Could not apply the look', err);
    toast(t('settings.common.save-failed'));
  };

  /**
   * While a Look is applied, presses are ignored rather than the buttons
   * disabled: a disabled button drops keyboard focus. Afterwards the page
   * redraws (`onChanged`), and a section `onChanged` didn't replace (first-run
   * setup) draws itself; either way focus goes back where it was.
   */
  function run(work: Promise<unknown>): void {
    busy = true;
    section.setAttribute('aria-busy', 'true');
    const done = () => {
      busy = false;
      section.removeAttribute('aria-busy');
      refocus = focusedText(section);
    };
    void work.then(
      () => {
        done();
        onChanged();
        if (section.isConnected) void draw();
      },
      (err: unknown) => (done(), failed(err), draw()),
    );
  }

  function card(look: LookPreset, pressed: boolean): HTMLElement {
    const button = h('button', { class: 'theme-card look-card', 'aria-pressed': String(pressed) }, lookMiniature(look), h('span', { class: 'theme-card-name' }, look.name), h('span', { class: 'pl-card-hint' }, t(HINTS[look.id])));
    // A tick on the chosen card: its accent border alone looked like the focus ring, so in first-run setup
    // the focused card and the chosen one read as two picks. `aria-pressed` already says which it is.
    if (pressed) button.append(h('span', { class: 'look-card-check', 'aria-hidden': 'true' }, icon('check')));
    button.addEventListener('click', () => {
      if (pressed || busy) return;
      run(applyLook(look.id).then(() => toast(t('looks.applied', { name: look.name }))));
    });
    return button;
  }

  // The panel is kept while another category shows; a change made meanwhile is drawn once it's back.
  let stale = false;

  async function draw(): Promise<void> {
    stale = false;
    const [player, backup] = await Promise.all([loadPlayerLayout(), lookBackup()]);
    const active = activeLook(player);
    // A section drawn just after a Look was applied (the page redrew around it) takes the focus the old one had.
    const focused = focusedText(section) ?? refocus;
    refocus = null;
    const parts: (HTMLElement | string)[] = [
      h('h3', { class: 'settings-subheading looks-heading' }, t('looks.heading')),
      h('p', { class: 'setting-hint looks-hint' }, t('looks.hint')),
      h('div', { class: 'theme-grid looks-grid', role: 'group', 'aria-label': t('looks.presets-label') }, ...LOOKS.map((look) => card(look, look === active))),
    ];
    if (backup) {
      const restore = h('button', { class: 'button' }, t('looks.restore'));
      restore.addEventListener('click', () => !busy && run(restoreLook().then((done) => done && toast(t('looks.restored')))));
      // Named by the Look, not the button: the palette finds it by its class.
      const restoreRow = row(active ? active.name : t('looks.custom'), t('lookstyles.restore-hint'), restore);
      restoreRow.classList.add('looks-restore');
      parts.push(restoreRow);
    }
    section.replaceChildren(...parts);
    // Redrawing shouldn't lose keyboard focus; after a restore (its button gone) it goes to the pressed Look, or the first.
    if (focused) ([...section.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === focused) ?? section.querySelector<HTMLElement>('.look-card[aria-pressed="true"], .look-card'))?.focus();
  }

  // Theme cards, the banner rows, Theme Studio, the Player page…: any of them can change which Look is on.
  // The page draws a new section after each Look, so an older one's listener leaves once it's been replaced.
  // Counted per owner: first-run setup's section mustn't retire the Settings page's.
  const generation = (generations.get(owner) ?? 0) + 1;
  generations.set(owner, generation);
  const onSaved = (event: Event) => {
    if (generation !== generations.get(owner)) return document.removeEventListener(SETTING_SAVED, onSaved);
    if (busy || !WATCHED.has((event as CustomEvent<string>).detail)) return;
    if (section.isConnected) void draw();
    else stale = true;
  };
  document.addEventListener(SETTING_SAVED, onSaved);
  for (const type of ['pointerenter', 'focusin'] as const) section.addEventListener(type, () => stale && !busy && void draw());

  void draw();
  return section;
}
