/**
 * A Settings row for something edited only in Theme Studio (the colours, the
 * seek bar, the menu's pages): its name and what it covers, and a button that
 * opens the Studio right there. One editor each, so the two can't disagree.
 */
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { openThemeStudio, type StudioPlace } from '../studio';
import { row } from './playback';

export function studioLink(label: string, hint: string, place: StudioPlace): HTMLElement {
  const button = h('button', { class: 'button studio-link' }, icon('palette'), t('studio.edit-in'));
  button.addEventListener('click', () => openThemeStudio(place));
  const element = row(label, hint, button);
  element.classList.add('studio-link-row');
  return element;
}
