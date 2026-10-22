/** Settings → Home & Library: the Anime tab and story arcs, Continue Watching, spoilers, and Home's rows. (Alerts and importing history are under General; title logos under Appearance.) */
import { animeTabShown, setAnimeTabShown } from '../../app/anime-tab';
import { createSwitch } from '../../components/switch';
import { refreshWatchedMarks } from '../../components/watched-marks';
import { toast } from '../../components/toast';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { appearance, setAppearance } from '../../theme/appearance';
import { setSpoilers, spoilers, type Spoilers } from '../../library/spoilers';
import { homeRowsSection } from '../home/editor';
import { CONTINUE_DAYS_CHOICES, setWatchPrefs, WATCHED_AT_CHOICES, watchPrefs } from '../../library/watch';
import { chapter, choices, row } from './playback';
import { showDependents, spoilerScopeShown } from './dependent-rows';

function failed(err: unknown): void {
  console.error('Could not save setting', err);
  toast(t('settings.common.save-failed'));
}

export function libraryPanel(): HTMLElement {
  const anime = h('div', {});
  void animeTabShown().then((shown) => {
    const toggle = createSwitch('', shown, (on) => setAnimeTabShown(on).catch(failed));
    toggle.setAttribute('aria-label', t('settings.library.anime-label'));
    anime.replaceChildren(row(t('settings.library.anime'), t('settings.library.anime-hint'), toggle));
  });
  // "Applies to" only matters once something is hidden.
  let hidden = spoilers();
  const spoilerSwitch = (key: Exclude<keyof Spoilers, 'scope'>, label: string, hint: string) => {
    const toggle = createSwitch('', hidden[key], (on) => {
      hidden = { ...hidden, [key]: on };
      showDependents(firstSpoiler, [scope], spoilerScopeShown(hidden));
      void setSpoilers({ [key]: on }).catch(failed);
    });
    toggle.setAttribute('aria-label', label);
    return row(label, hint, toggle);
  };
  const firstSpoiler = spoilerSwitch('titles', t('spoilers.titles'), t('spoilers.titles-hint'));
  const scope = row(
    t('spoilers.scope'),
    t('spoilers.scope-hint'),
    choices(t('spoilers.scope'), [['unwatched', t('spoilers.scope-unwatched')], ['all', t('spoilers.scope-all')]] as const, hidden.scope, (value) => void setSpoilers({ scope: value }).catch(failed)),
  );
  showDependents(firstSpoiler, [scope], spoilerScopeShown(hidden));
  const arcs = createSwitch('', appearance().storyArcs, (on) => void setAppearance({ storyArcs: on }).catch(failed));
  arcs.setAttribute('aria-label', t('titles.settings.story-arcs'));
  const marks = createSwitch('', appearance().watchedMarks, (on) => void setAppearance({ watchedMarks: on }).then(refreshWatchedMarks).catch(failed));
  marks.setAttribute('aria-label', t('settings.library.watched-marks'));
  const { watchedAt, continueDays } = watchPrefs();
  const watched = row(
    t('settings.library.watched'),
    t('settings.library.watched-hint'),
    choices(t('settings.library.watched'), WATCHED_AT_CHOICES.map((c) => [c, new Intl.NumberFormat(locale(), { style: 'percent' }).format(c)] as const), watchedAt, (value) => void setWatchPrefs({ watchedAt: value }).catch(failed)),
  );
  const dropOff = row(
    t('settings.library.drop-off'),
    t('settings.library.drop-off-hint'),
    choices(t('settings.library.drop-off'), CONTINUE_DAYS_CHOICES.map((c) => [c, c ? tn('settings.library.days', c) : t('settings.library.never')] as const), continueDays, (value) => void setWatchPrefs({ continueDays: value }).catch(failed)),
  );
  return h(
    'div',
    {},
    chapter('settingslayout.chapter.library'),
    anime,
    row(t('titles.settings.story-arcs'), t('titles.settings.story-arcs-hint'), arcs),
    row(t('settings.library.watched-marks'), t('settings.library.watched-marks-hint'), marks),
    h('h3', { class: 'settings-subheading' }, t('settings.library.continue-heading')),
    watched,
    dropOff,
    h('h3', { class: 'settings-subheading spoilers-section' }, t('spoilers.heading')),
    h('p', { class: 'muted settings-intro' }, t('spoilers.intro')),
    firstSpoiler,
    spoilerSwitch('descriptions', t('spoilers.descriptions'), t('spoilers.descriptions-hint')),
    spoilerSwitch('thumbnails', t('spoilers.thumbnails'), t('spoilers.thumbnails-hint')),
    spoilerSwitch('ratings', t('spoilers.ratings'), t('spoilers.ratings-hint')),
    spoilerSwitch('unaired', t('spoilers.unaired'), t('spoilers.unaired-hint')),
    scope,
    homeRowsSection(),
  );
}
