/** Settings → Playback → Resume: Ask. Shown on the loading screen before the video opens. */
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { formatTime } from './format';

/** "Resume from 23:14" or "Start from the beginning"; calls `onPick` with where to start. */
export function resumePrompt(position: number, onPick: (start: number | undefined) => void): HTMLElement {
  const resume = h('button', { class: 'button large primary' }, t('player.resume.from', { time: formatTime(position) }));
  resume.addEventListener('click', () => onPick(position));
  const over = h('button', { class: 'button large glass' }, t('player.resume.start-over'));
  over.addEventListener('click', () => onPick(undefined));
  return h('div', { class: 'hero-actions resume-prompt' }, resume, over);
}
