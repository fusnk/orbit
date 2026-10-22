/**
 * Resuming a movie or episode (Continue Watching, a title page's Resume):
 * which source to go on with. Settings → Playback → When resuming: Ask
 * (default), the last source, the source picker, or the best source.
 *
 * "Ask" only asks when Orbit knows the source it last played from (see
 * player/last-source.ts); otherwise resuming works as it always has. The
 * prompt shows only what the source picker shows (addon, quality, release),
 * never an address.
 */
import { onBack } from '../../app/back';
import { artImage } from '../../components/cards';
import { pushLayer } from '../../components/layers';
import { createSwitch } from '../../components/switch';
import type { Title } from '../../catalog/titles';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { profileSetting } from '../../library/profiles';
import { pauseBehindPrompt, resumeAfterPrompt } from '../player';
import { whereKey } from '../player/failed-sources';
import { decideResume, lastSourceFor, lastSourceLine, parseResumeSourceMode, RESUME_SOURCE_PREFIX, type LastSource, type ResumeChoice, type ResumeSourceMode } from '../player/last-source';
import type { EpisodeRef } from './title-actions';
import './resume-choice.css';

/**
 * Settles what resuming `title` (at `episode`) should do: null if the person
 * cancelled the prompt, undefined if nothing special applies.
 */
export async function resumeChoice(title: Title, episode: EpisodeRef | undefined): Promise<ResumeChoice | null | undefined> {
  const [{ key, value }, last] = await Promise.all([profileSetting(RESUME_SOURCE_PREFIX), lastSourceFor(whereKey(title.id, episode?.episode.id)).catch(() => undefined)]);
  const decided = decideResume(parseResumeSourceMode(value), last);
  if (decided !== 'ask') return decided;
  return askResume(title, episode, last!, (mode) => void settings.set(key, mode).catch((err: unknown) => console.warn('Could not save', RESUME_SOURCE_PREFIX, err)));
}

/** The prompt: three ways on, "Remember my choice", over the title's art. Escape or Back cancels. */
function askResume(title: Title, episode: EpisodeRef | undefined, last: LastSource, remember: (mode: ResumeSourceMode) => void): Promise<ResumeChoice | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    let remembered = false;
    const rememberSwitch = createSwitch(t('player.resume-source.remember'), false, (on) => (remembered = on));
    rememberSwitch.classList.add('resume-choice-remember');

    const option = (label: string, detail: string, extra: string, choice: ResumeChoice, mode: ResumeSourceMode, primary = false) => {
      const button = h(
        'button',
        { class: `resume-option${primary ? ' primary' : ''}`, 'data-focus-id': `resume-${mode}` },
        h('span', { class: 'resume-option-label' }, label),
        detail ? h('span', { class: 'resume-option-detail' }, detail) : '',
        extra ? h('span', { class: 'resume-option-extra' }, extra) : '',
      );
      button.addEventListener('click', () => {
        if (remembered) remember(mode);
        close(choice);
      });
      return button;
    };

    const heading = episode ? `${title.name} · ${t('titles.common.episode-code', { season: episode.season, episode: episode.episode.number })}` : title.name;
    const card = h(
      'div',
      { class: 'resume-choice', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'resume-choice-title' },
      title.background ? artImage(title.background, 'resume-choice-art', true) : '',
      h('div', { class: 'resume-choice-shade', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'resume-choice-body' },
        h('span', { class: 'eyebrow' }, t('player.resume-source.eyebrow')),
        h('span', { class: 'resume-choice-title', id: 'resume-choice-title' }, heading),
        h(
          'div',
          { class: 'resume-options' },
          option(t('player.resume-source.last'), lastSourceLine(last), last.filename, { kind: 'last', last }, 'last', true),
          option(t('player.resume-source.choose'), t('player.resume-source.choose-hint'), '', { kind: 'choose' }, 'choose'),
          option(t('player.resume-source.best'), t('player.resume-source.best-hint'), '', { kind: 'best' }, 'best'),
        ),
        rememberSwitch,
      ),
    );
    const scrim = h('div', { class: 'scrim resume-choice-scrim' });
    const layer = h('div', { class: 'resume-choice-layer' }, card);

    let done = false;
    function close(choice: ResumeChoice | null): void {
      if (done) return;
      done = true;
      removeBack();
      removeLayer();
      layer.remove();
      scrim.remove();
      // Whatever was chosen, focus goes back to Play: the option pressed is gone, and what follows (the search, the player) returns there too.
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      // Dismissed: nothing switches, so what waited behind the prompt plays on.
      if (!choice && paused) resumeAfterPrompt();
      resolve(choice);
    }
    const removeBack = onBack(() => close(null));
    scrim.addEventListener('click', () => close(null));
    layer.addEventListener('click', (event) => {
      if (event.target === layer) close(null);
    });
    // Picked in the player (its Episodes panel): what's playing there waits behind the prompt.
    const paused = pauseBehindPrompt();
    document.body.append(scrim, layer);
    const removeLayer = pushLayer(layer, () => close(null));
    requestAnimationFrame(() => scrim.classList.add('open'));
    card.querySelector<HTMLElement>('.resume-option')?.focus({ preventScroll: true });
  });
}
