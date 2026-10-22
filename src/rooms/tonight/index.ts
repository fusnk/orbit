/**
 * Tonight (Quick settings, Ctrl+K): the time the person has and a mood,
 * then three suggestions with Play, Details and Another. The choosing is
 * catalog/tonight; this gathers what Orbit already holds (Continue
 * Watching, My Library, catalog pages already loaded), keeps what the
 * profile's content limit allows, and draws the drawer. Nothing is fetched
 * from addons for it.
 *
 * Titles come from addons: text nodes only.
 */
import type { RoomContext } from '../../app/router';
import { allowedTitles } from '../../catalog/parental';
import { loadedCatalogTitles } from '../../catalog/service';
import { pickTonight, rankTonight, TONIGHT_MOODS, TONIGHT_TIMES, type TonightCandidate, type TonightChoice, type TonightMood, type TonightSource, type TonightTime } from '../../catalog/tonight';
import { fallbackHue, type Title } from '../../catalog/titles';
import { artImage, titleMeta, withHue } from '../../components/cards';
import { openDrawer } from '../../components/drawer';
import { icon, type IconName } from '../../components/icons';
import { createSwitch } from '../../components/switch';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { libraryEntries } from '../../library/library';
import { continueWatching, isWatched, lastWatchedAt } from '../../library/watch';
import { titleHandlers } from '../detail/open';
import { minutesToWatch, primaryAction } from '../detail/showcase-hero';
import './tonight.css';

const TIME_LABELS: Record<TonightTime, MessageKey> = { 30: 'tonight.time-30', 60: 'tonight.time-60', 90: 'tonight.time-90', 120: 'tonight.time-120' };
/** The same icons as Home's mood chips where the moods match. */
const MOOD_ICONS: Record<TonightMood, IconName> = { light: 'sun', intense: 'bolt', cozy: 'heart', 'mind-bending': 'spiral' };

/** The last choices, kept for the session. */
const choice: TonightChoice = { time: 90, mood: null, unwatchedOnly: false };

/** Everything Tonight may choose from, in source order, already past the content limit. */
async function gather(): Promise<TonightCandidate[]> {
  const sourced: { title: Title; from: TonightSource }[] = [
    ...continueWatching().map((entry) => ({ title: entry.title, from: 'continue' as const })),
    ...libraryEntries().map((entry) => ({ title: entry.title, from: 'library' as const })),
    ...(await loadedCatalogTitles()).map((title) => ({ title, from: 'catalog' as const })),
  ];
  const unique = [...new Map(sourced.map(({ title }) => [title.id, title])).values()];
  const allowed = new Set((await allowedTitles(unique)).map((title) => title.id));
  return sourced
    .filter(({ title }) => allowed.has(title.id))
    .map(({ title, from }) => ({ title, from, minutes: minutesToWatch(title), started: lastWatchedAt(title.id) > 0, finished: isWatched(title) }));
}

export function openTonight(ctx: RoomContext): void {
  const { play, openDetail } = titleHandlers(ctx);
  let pool: TonightCandidate[] | null = null;
  let ranked: TonightCandidate[] = [];
  /** Titles offered since the choices last changed, so Another never repeats one. */
  let offered = new Set<string>();

  const live = h('p', { class: 'tonight-status muted', role: 'status', 'aria-live': 'polite' }, t('tonight.loading'));
  const picks = h('div', { class: 'tonight-picks', role: 'group', 'aria-label': t('tonight.picks') });

  function segments(): HTMLElement {
    const group = h('div', { class: 'segments', role: 'group', 'aria-label': t('tonight.time') });
    for (const time of TONIGHT_TIMES) {
      const button = h('button', { class: 'segment', 'aria-pressed': String(choice.time === time), 'data-focus-id': `tonight-time:${time}` }, t(TIME_LABELS[time]));
      // Focus lands on the chosen time when the drawer opens.
      if (choice.time === time) button.dataset.autofocus = '';
      button.addEventListener('click', () => {
        choice.time = time;
        for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
        refresh(true);
      });
      group.append(button);
    }
    return group;
  }

  function moodChips(): HTMLElement {
    const group = h('div', { class: 'chips tonight-moods', role: 'group', 'aria-label': t('tonight.mood') });
    for (const mood of [null, ...TONIGHT_MOODS]) {
      const chip = h(
        'button',
        { class: 'chip mood-chip', 'aria-pressed': String(choice.mood === mood), 'data-focus-id': `tonight-mood:${mood ?? 'any'}` },
        mood ? icon(MOOD_ICONS[mood]) : '',
        h('span', {}, mood ? t(`tonight.mood.${mood}`) : t('insights.surprise.any')),
      );
      chip.addEventListener('click', () => {
        choice.mood = mood;
        for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === chip));
        refresh(true);
      });
      group.append(chip);
    }
    return group;
  }

  const field = (label: string, control: HTMLElement) => h('div', { class: 'surprise-field' }, h('span', { class: 'surprise-label' }, label), control);

  const content = h(
    'div',
    { class: 'surprise tonight' },
    h('h2', { class: 'surprise-title' }, t('tonight.title')),
    h('p', { class: 'tonight-intro muted' }, t('tonight.intro')),
    field(t('tonight.time'), segments()),
    field(t('tonight.mood'), moodChips()),
    createSwitch(t('insights.surprise.unwatched'), choice.unwatchedOnly, (on) => {
      choice.unwatchedOnly = on;
      refresh(true);
    }),
    live,
    picks,
  );
  const close = openDrawer(content, t('tonight.title'));

  function pickCard(c: TonightCandidate): HTMLElement {
    const { title } = c;
    const action = primaryAction(title);
    const playButton = h('button', { class: 'button primary' }, icon('play', { filled: true }), action.label);
    playButton.addEventListener('click', () => {
      close();
      play(title);
    });
    const details = h('button', { class: 'button glass' }, t('browse.hero.details'));
    details.addEventListener('click', () => {
      close();
      openDetail(title);
    });
    const another = h('button', { class: 'button glass tonight-another', 'aria-label': t('tonight.another-label', { name: title.name }) }, t('insights.surprise.another'));
    another.addEventListener('click', () => replace(card));
    const from = c.from === 'continue' ? t('browse.home.continue-watching') : c.from === 'library' ? t('tonight.from.library') : '';
    const note = [from, action.sub].filter(Boolean).join(' · ');
    const card = h(
      'div',
      { class: 'tonight-pick', 'data-title-id': title.id },
      withHue(h('div', { class: 'tonight-poster', 'aria-hidden': 'true' }, h('span', { class: 'tonight-poster-name' }, title.name), title.poster ? artImage(title.poster, 'art', true) : ''), fallbackHue(title.id)),
      h(
        'div',
        { class: 'tonight-info' },
        h('h3', { class: 'tonight-name', dir: 'auto' }, title.name),
        h('div', { class: 'hero-meta' }, ...titleMeta(title, { genres: false })),
        note ? h('span', { class: 'tonight-note' }, note) : '',
        h('div', { class: 'tonight-actions' }, playButton, details, another),
      ),
    );
    return card;
  }

  /** Another: the best suggestion not offered yet, in `card`'s place. */
  function replace(card: HTMLElement): void {
    const [next] = pickTonight(ranked, offered, 1);
    if (!next) {
      live.textContent = t('tonight.no-more');
      return;
    }
    offered.add(next.title.id);
    const fresh = pickCard(next);
    card.replaceWith(fresh);
    fresh.querySelector<HTMLElement>('.tonight-another')?.focus({ preventScroll: true });
    live.textContent = t('tonight.updated');
  }

  /** Ranks again for the current choices and shows the first three; `announce` says so (not on opening). */
  function refresh(announce: boolean): void {
    if (!pool) return;
    ranked = rankTonight(pool, choice);
    const first = pickTonight(ranked, new Set());
    offered = new Set(first.map((c) => c.title.id));
    if (!first.length) {
      live.textContent = '';
      picks.replaceChildren(h('div', { class: 'surprise-none' }, h('span', { class: 'surprise-none-title' }, t('tonight.none')), h('p', { class: 'muted' }, t('tonight.none-body'))));
      return;
    }
    live.textContent = announce ? t('tonight.updated') : '';
    picks.replaceChildren(...first.map(pickCard));
  }

  void gather()
    .catch((err: unknown) => {
      console.warn('Tonight: could not gather titles', err);
      return [];
    })
    .then((gathered) => {
      pool = gathered;
      refresh(false);
    });
}
