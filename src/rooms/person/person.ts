/**
 * A person's page (from a title's cast, with a TMDB token): photo, details,
 * biography, and the movies and shows they're best known for.
 */
import { markActivity } from '../../app/activity';
import type { RoomContext } from '../../app/router';
import { personDetails, type Person } from '../../catalog/tmdb';
import { artImage } from '../../components/cards';
import { connectTmdbButton, errorState, stateMessage } from '../../components/state-message';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import './person.css';

const fullDate = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso: string | null) => {
  const date = iso ? new Date(iso) : undefined;
  return date && !Number.isNaN(date.getTime()) ? fullDate.format(date) : undefined;
};
/** Biographies longer than this start collapsed. */
const BIO_PREVIEW = 600;

export function createPersonPage(id: number, name: string, ctx: RoomContext): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const page = h('div', { class: 'person-page' }, h('div', { class: 'skeleton person-skeleton', 'aria-hidden': 'true' }));
  markActivity(page, t('titles.person.activity'), name);

  function render(person: Person): void {
    const born = [formatDate(person.birthday), person.placeOfBirth].filter(Boolean).join(' · ');
    const died = formatDate(person.deathday);
    const bio = person.biography ?? '';
    const bioText = h('p', { class: 'person-bio' }, bio.length > BIO_PREVIEW ? `${bio.slice(0, BIO_PREVIEW).trimEnd()}…` : bio);
    const more = h('button', { class: 'button glass small', hidden: bio.length <= BIO_PREVIEW }, t('titles.person.read-more'));
    more.addEventListener('click', () => {
      bioText.textContent = bio;
      // The button goes; focus stays on the text it opened, so the keyboard carries on from there.
      bioText.tabIndex = -1;
      bioText.focus({ preventScroll: true });
      more.hidden = true;
    });
    page.replaceChildren(
      h(
        'header',
        { class: 'person-header' },
        person.photo ? h('span', { class: 'person-photo' }, artImage(person.photo, 'art', true)) : '',
        h(
          'div',
          { class: 'person-text' },
          h('span', { class: 'eyebrow' }, t('titles.person.eyebrow')),
          h('h1', { class: 'page-title' }, person.name),
          born ? h('p', { class: 'muted' }, t('titles.person.born', { date: born })) : '',
          died ? h('p', { class: 'muted' }, t('titles.person.died', { date: died })) : '',
          bio ? bioText : '',
          more,
        ),
      ),
      person.knownFor.length
        ? h(
            'section',
            { class: 'person-known' },
            h('h2', { class: 'section-title' }, t('titles.person.known-for')),
            h('div', { class: 'title-grid' }, ...person.knownFor.map((title) => titleCard(title, () => openDetail(title), {}, (card) => withMenu(card, title)))),
          )
        : '',
      h('p', { class: 'facts-source' }, t('titles.person.from-tmdb')),
    );
    // Like a title page's Play: the keyboard starts on the page (its first title, else Read more)
    // rather than nowhere, once there's something to start on.
    const start = page.querySelector<HTMLElement>('.person-known .card:not([hidden])') ?? (more.hidden ? null : more);
    if (!start) return;
    start.dataset.autofocus = '';
    const active = document.activeElement;
    if (page.isConnected && (!active || active === document.body)) start.focus({ preventScroll: true });
  }

  const load = (): void =>
    void personDetails(id)
      .then((person) => {
        if (person) render(person);
        else page.replaceChildren(stateMessage({ icon: 'link', title: t('states.tmdb.title'), detail: t('states.tmdb.detail'), action: connectTmdbButton(ctx.go) }));
      })
      .catch((err: unknown) => page.replaceChildren(errorState({ title: t('titles.common.couldnt-load', { name }), err, retry: load, go: ctx.go, service: 'tmdb' })));
  load();
  return page;
}
