/**
 * A person filter in Discover's panel (cast, director): a chip for the person
 * picked, which clears it, and a search field over TMDB's people search whose
 * hits are buttons. The field only starts editing on Enter or a click
 * (createTextField), so a controller passing through doesn't open a keyboard.
 */
import { searchPeople } from '../../catalog/tmdb';
import { icon } from '../../components/icons';
import { errorText } from '../../components/state-message';
import { createTextField } from '../../components/text-field';
import { formatList, t } from '../../i18n';
import { h } from '../../lib/dom';
import type { FilterPerson } from './filters';

/** Hits shown under the field. */
const MAX_HITS = 6;
/** How long typing must pause before people are searched. */
const SEARCH_DELAY_MS = 350;

export interface PersonFilter {
  element: HTMLElement;
  set(person: FilterPerson | null): void;
}

export function createPersonFilter(label: string, onPick: (person: FilterPerson | null) => void): PersonFilter {
  const chipName = h('span', {});
  const chip = h('button', { class: 'chip filter-person', 'aria-pressed': 'true' }, chipName, icon('close'));
  // Focus moves to what replaces the control just used, so a controller isn't left nowhere.
  chip.addEventListener('click', () => {
    onPick(null);
    input.focus({ preventScroll: true });
  });
  const hits = h('div', { class: 'filter-person-hits', role: 'group', 'aria-label': label });
  const status = h('span', { class: 'filter-hint', role: 'status' });
  let timer = 0;
  let asked = 0;

  async function search(query: string): Promise<void> {
    const ask = ++asked;
    const text = query.trim();
    if (text.length < 2) {
      hits.replaceChildren();
      status.textContent = '';
      return;
    }
    // A failed search says why, rather than "No one found".
    const found = await searchPeople(text).catch((err: unknown) => ({ err }));
    if (ask !== asked) return;
    const people = Array.isArray(found) ? found.slice(0, MAX_HITS) : [];
    status.textContent = found && 'err' in found ? errorText(found.err, { service: 'tmdb' }) : people.length ? '' : t('explore.filters.person-none');
    hits.replaceChildren(
      ...people.map((person) => {
        const button = h('button', { class: 'chip' }, person.name, person.knownFor.length ? h('span', { class: 'filter-person-known' }, formatList(person.knownFor.slice(0, 2))) : '');
        button.addEventListener('click', () => {
          // A search still on its way mustn't bring the hits back.
          asked++;
          clearTimeout(timer);
          input.value = '';
          hits.replaceChildren();
          onPick({ id: person.id, name: person.name });
          chip.focus({ preventScroll: true });
        });
        return button;
      }),
    );
  }

  const input = createTextField({
    label: t('explore.filters.person-search', { what: label }),
    placeholder: t('explore.filters.person-placeholder'),
    className: 'filter-person-field',
    onSubmit: (value) => {
      clearTimeout(timer);
      void search(value);
    },
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void search(input.value), SEARCH_DELAY_MS);
  });

  const element = h('div', { class: 'filter-person-picker' }, chip, input, hits, status);
  return {
    element,
    set(person) {
      chip.hidden = person === null;
      chipName.textContent = person?.name ?? '';
      chip.setAttribute('aria-label', person ? t('explore.filters.person-clear', { name: person.name }) : '');
      input.hidden = person !== null;
      if (person !== null) {
        asked++;
        clearTimeout(timer);
        hits.replaceChildren();
        status.textContent = '';
      }
    },
  };
}
