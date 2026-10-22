import { describe, expect, it } from 'vitest';
import { everyTranslation, loadEveryCatalog } from '../i18n';
import { GENRE_LABELS } from './explore';
import { genreNames, hasFilters, inYears, intentChips, intentFilters, intentStands, parseSearchIntent, type DiscoverIntent } from './search-intent';

/** Genre names in every interface language, as Search builds them. */
await loadEveryCatalog();
const names = genreNames((key) => everyTranslation(GENRE_LABELS[key]));
const parse = (query: string) => parseSearchIntent(query, { thisYear: 2026, genreNames: names });

const base = { kind: 'discover', text: '', media: 'both', anime: false, genres: [], language: undefined, country: undefined, from: undefined, to: undefined, maxRuntime: undefined, sort: 'popular' } as const;
const intent = (over: Partial<DiscoverIntent>): DiscoverIntent => ({ ...base, ...over, genres: over.genres ?? [] });

describe('parseSearchIntent: filters', () => {
  it('reads genre, kind, sort and decade', () => {
    expect(parse('best horror movies 2020s')).toEqual(intent({ media: 'movie', genres: ['horror'], from: 2020, to: 2029, sort: 'top' }));
    expect(parse('Top rated comedies 2010s')).toMatchObject({ media: 'both', genres: ['comedy'], from: 2010, to: 2019, sort: 'top' });
    expect(parse('90s action')).toMatchObject({ genres: ['action'], from: 1990, to: 1999 });
    expect(parse('sci-fi shows from the 90’s')).toMatchObject({ media: 'series', genres: ['scifi'], from: 1990, to: 1999 });
    expect(parse('romantic comedy')).toMatchObject({ genres: ['romance', 'comedy'] });
    expect(parse('scary movies')).toMatchObject({ media: 'movie', genres: ['horror'] });
    expect(parse('best movies')).toMatchObject({ media: 'movie', genres: [], sort: 'top' });
  });

  it('reads languages and countries', () => {
    expect(parse('korean thrillers')).toEqual(intent({ genres: ['thriller'], language: 'ko' }));
    expect(parse('french comedies')).toMatchObject({ genres: ['comedy'], language: 'fr' });
    expect(parse('bollywood movies')).toMatchObject({ media: 'movie', language: 'hi' });
    expect(parse('british crime shows')).toMatchObject({ media: 'series', genres: ['crime'], country: 'GB' });
    expect(parse('k-dramas')).toMatchObject({ media: 'series', genres: ['drama'], language: 'ko' });
  });

  it('reads anime as its own kind', () => {
    expect(parse('top rated anime')).toEqual(intent({ anime: true, sort: 'top' }));
    expect(parse('anime movies')).toMatchObject({ anime: true, media: 'movie' });
    expect(parse('new anime')).toMatchObject({ anime: true, sort: 'new' });
    // Anime is a kind of its own, so the word alone asks for it.
    expect(parse('anime')).toMatchObject({ anime: true });
  });

  it('reads year ranges', () => {
    expect(parse('movies since 2015')).toMatchObject({ media: 'movie', from: 2015, to: undefined });
    expect(parse('movies from 2015')).toMatchObject({ from: 2015, to: undefined });
    expect(parse('horror movies after 2010')).toMatchObject({ from: 2011, to: undefined });
    expect(parse('horror movies before 2000')).toMatchObject({ from: undefined, to: 1999 });
    expect(parse('thrillers until 1999')).toMatchObject({ to: 1999 });
    expect(parse('movies from 2010 to 2015')).toMatchObject({ from: 2010, to: 2015 });
    expect(parse('comedies 2010-2015')).toMatchObject({ from: 2010, to: 2015 });
    expect(parse('movies 2012')).toMatchObject({ media: 'movie', from: 2012, to: 2012 });
    expect(parse('action movies since the 90s')).toMatchObject({ from: 1990, to: undefined });
    expect(parse('80s horror movies before 1985')).toMatchObject({ from: 1980, to: 1984 });
    expect(parse('the nineties comedies')).toMatchObject({ from: 1990, to: 1999 });
  });

  it('reads runtimes', () => {
    expect(parse('comedies under 90 minutes')).toEqual(intent({ genres: ['comedy'], maxRuntime: 90 }));
    expect(parse('comedies under 90 min')).toMatchObject({ maxRuntime: 90 });
    expect(parse('comedies under 90mins')).toMatchObject({ maxRuntime: 90 });
    expect(parse('comedies under 90')).toMatchObject({ maxRuntime: 90 });
    expect(parse('movies less than 2 hours')).toMatchObject({ media: 'movie', maxRuntime: 120 });
    expect(parse('thrillers 100 minutes or less')).toMatchObject({ maxRuntime: 100 });
    expect(parse('short comedies')).toMatchObject({ maxRuntime: 'short' });
    // Not a runtime: "under 18".
    expect(parse('movies under 18')).toBeNull();
  });

  it('reads "best new" as the best of the last two years', () => {
    expect(parse('best new movies')).toMatchObject({ sort: 'top', from: 2025 });
  });

  it('keeps words left over as a title, filtered by kind and years', () => {
    expect(parse('batman movies from the 90s')).toEqual(intent({ text: 'batman', media: 'movie', from: 1990, to: 1999 }));
    expect(parse('dune movies 2021')).toMatchObject({ text: 'dune', media: 'movie', from: 2021, to: 2021 });
    // Only kind and years can be checked on a title found by name.
    expect(parse('best batman movies 90s')).toBeNull();
    expect(parse('batman horror movies 90s')).toBeNull();
  });
});

describe('parseSearchIntent: like and with', () => {
  it('reads "like" searches', () => {
    expect(parse('films like Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
    expect(parse('shows like Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
    expect(parse('movies similar to The Matrix')).toEqual({ kind: 'like', media: 'movie', title: 'the matrix' });
    expect(parse('tv shows like The Office')).toEqual({ kind: 'like', media: 'series', title: 'the office' });
    expect(parse('more like dune')).toEqual({ kind: 'like', media: 'both', title: 'dune' });
    expect(parse('something like Alien')).toEqual({ kind: 'like', media: 'both', title: 'alien' });
  });

  it('reads "with" searches', () => {
    expect(parse('movies with Tom Hanks')).toEqual({ kind: 'person', media: 'movie', name: 'tom hanks' });
    expect(parse('starring Viola Davis')).toEqual({ kind: 'person', media: 'both', name: 'viola davis' });
  });

  it('tells a title from a search for ones like it', () => {
    expect(parse('heat')).toBeNull();
    expect(parse('Heat 1995')).toBeNull();
    expect(parse('films like heat')).toMatchObject({ kind: 'like', title: 'heat' });
    expect(parse('Like Crazy')).toBeNull();
  });
});

describe('parseSearchIntent: plain titles stay plain', () => {
  it('leaves real titles alone', () => {
    for (const title of [
      'Dune',
      'tom hanks',
      'Best in Show',
      'The Best of Me',
      'Like Crazy',
      'Top Gun',
      'Scary Movie',
      'Horror',
      'Thriller',
      '2012',
      'War',
      'The Family',
      'Crime Story',
      'Movie 43',
      'Show Me Love',
      'French Kiss',
      'Dune 2021',
      'Popular',
      'The 90s Show',
      'That ’90s Show',
      'Short Term 12',
      'New Girl',
      'Blade Runner 2049',
      'Die Hard',
      'Les Misérables',
      'The Good, the Bad and the Ugly',
      'Us',
      'Bee Movie',
      'A Quiet Place',
    ]) {
      expect(parse(title), title).toBeNull();
    }
  });

  it('rejects contradictions and impossible dates', () => {
    expect(parse('korean japanese movies')).toBeNull();
    expect(parse('horror movies tv shows')).toBeNull();
    expect(parse('horror movies 2050s')).toBeNull();
    expect(parse('horror movies 2010s 1995')).toBeNull();
    expect(parse('horror movies after 2030')).toBeNull();
  });
});

describe('parseSearchIntent: other languages', () => {
  it('reads Spanish', () => {
    expect(parse('mejores películas de terror')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('películas de terror de los años 90')).toMatchObject({ genres: ['horror'], from: 1990, to: 1999 });
    expect(parse('comedias de menos de 90 minutos')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('películas como Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
    expect(parse('series desde 2015')).toMatchObject({ media: 'series', from: 2015 });
    expect(parse('dibujos animados')).toMatchObject({ genres: ['animation'] });
    expect(parse('comédies musicales')).toMatchObject({ genres: ['music'] });
  });

  it('reads French', () => {
    expect(parse('meilleurs films d’horreur')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('films des années 80')).toMatchObject({ media: 'movie', from: 1980, to: 1989 });
    expect(parse('comédies de moins de 90 minutes')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('séries comme Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
    expect(parse('films de science-fiction avant 2000')).toMatchObject({ genres: ['scifi'], to: 1999 });
  });

  it('reads Portuguese', () => {
    expect(parse('melhores filmes de terror')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('filmes de ficção científica dos anos 80')).toMatchObject({ genres: ['scifi'], from: 1980, to: 1989 });
    expect(parse('filmes como Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads German, compounds included', () => {
    expect(parse('beste Horrorfilme der 80er')).toMatchObject({ media: 'movie', genres: ['horror'], from: 1980, to: 1989, sort: 'top' });
    expect(parse('Liebesfilme unter 90 Minuten')).toMatchObject({ media: 'movie', genres: ['romance'], maxRuntime: 90 });
    expect(parse('Filme wie Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
    expect(parse('Komödien seit 2015')).toMatchObject({ genres: ['comedy'], from: 2015 });
  });

  it('reads Italian', () => {
    expect(parse('migliori film horror anni 90')).toMatchObject({ genres: ['horror'], from: 1990, to: 1999, sort: 'top' });
    expect(parse('commedie meno di 90 minuti')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('film come Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads Dutch', () => {
    expect(parse('beste films uit de jaren 90')).toMatchObject({ media: 'movie', from: 1990, to: 1999, sort: 'top' });
    expect(parse('actiefilms onder 90 minuten')).toMatchObject({ media: 'movie', genres: ['action'], maxRuntime: 90 });
    expect(parse('series zoals Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
  });

  it('reads Polish', () => {
    expect(parse('najlepsze horrory')).toMatchObject({ genres: ['horror'], sort: 'top' });
    expect(parse('komedie poniżej 90 minut')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('filmy z lat 90')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('filmy jak Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads Russian', () => {
    expect(parse('лучшие фильмы ужасов')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('комедии до 90 минут')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('фильмы 90-х')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('корейские сериалы')).toMatchObject({ media: 'series', language: 'ko' });
    expect(parse('фильмы как Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads Ukrainian', () => {
    expect(parse('найкращі трилери')).toMatchObject({ genres: ['thriller'], sort: 'top' });
    expect(parse('фільми 90-ті')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('японські серіали')).toMatchObject({ media: 'series', language: 'ja' });
    expect(parse('серіали як Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
  });

  it('reads Swedish, compounds included', () => {
    expect(parse('bästa skräckfilmer')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('komedier under 90 minuter')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('filmer från 90-talet')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('koreanska thrillers')).toMatchObject({ genres: ['thriller'], language: 'ko' });
    expect(parse('serier som Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
  });

  it('reads Indonesian', () => {
    expect(parse('film horor terbaik')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('film terbaik tahun 90-an')).toMatchObject({ media: 'movie', from: 1990, to: 1999, sort: 'top' });
    expect(parse('komedi kurang dari 90 menit')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('drakor terbaru')).toMatchObject({ media: 'series', genres: ['drama'], language: 'ko', sort: 'new' });
    expect(parse('film seperti Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads Arabic', () => {
    expect(parse('أفلام رعب')).toMatchObject({ media: 'movie', genres: ['horror'] });
    expect(parse('أفضل أفلام الرعب')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('أفلام أقل من ٩٠ دقيقة')).toMatchObject({ media: 'movie', maxRuntime: 90 });
    expect(parse('أفلام التسعينات')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('أفلام مثل Heat')).toEqual({ kind: 'like', media: 'movie', title: 'heat' });
  });

  it('reads Czech', () => {
    expect(parse('nejlepší horory')).toMatchObject({ genres: ['horror'], sort: 'top' });
    expect(parse('komedie pod 90 minut')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('korejské thrillery')).toMatchObject({ genres: ['thriller'], language: 'ko' });
    expect(parse('české filmy')).toMatchObject({ media: 'movie', language: 'cs' });
    expect(parse('seriály jako Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
  });

  it('reads Hebrew', () => {
    expect(parse('סרטי אימה')).toMatchObject({ media: 'movie', genres: ['horror'] });
    expect(parse('סרטי האימה הטובים ביותר')).toMatchObject({ media: 'movie', genres: ['horror'], sort: 'top' });
    expect(parse('קומדיות פחות מ-90 דקות')).toMatchObject({ genres: ['comedy'], maxRuntime: 90 });
    expect(parse('סרטים משנות ה-90')).toMatchObject({ media: 'movie', from: 1990, to: 1999 });
    expect(parse('סרטים ישראליים')).toMatchObject({ media: 'movie', language: 'he' });
    expect(parse('סדרות כמו Severance')).toEqual({ kind: 'like', media: 'series', title: 'severance' });
  });

  it('needs the same clarity as English: a genre name alone is a title', () => {
    expect(parse('Terror')).toBeNull();
    expect(parse('Horreur')).toBeNull();
  });
});

describe('intentChips', () => {
  it('lists each filter with what removing it leaves', () => {
    const read = parse('best horror movies 2020s') as DiscoverIntent;
    const chips = intentChips(read);
    expect(chips.map((c) => c.chip)).toEqual([
      { kind: 'genre', genre: 'horror' },
      { kind: 'media', media: 'movie' },
      { kind: 'years', from: 2020, to: 2029 },
      { kind: 'sort', sort: 'top' },
    ]);
    expect(chips[0]!.without).toMatchObject({ genres: [], media: 'movie', sort: 'top' });
    expect(chips[2]!.without).toMatchObject({ from: undefined, to: undefined });
  });

  it('falls back to a plain search when nothing would be left', () => {
    const [genre] = intentChips(intent({ genres: ['horror'] }));
    expect(genre!.without).toBeNull();
    const like = intentChips({ kind: 'like', media: 'movie', title: 'heat' });
    expect(like.map((c) => c.without)).toEqual([null, { kind: 'like', media: 'both', title: 'heat' }]);
  });

  it('keeps the words of a title search as a chip', () => {
    const chips = intentChips(parse('batman movies from the 90s') as DiscoverIntent);
    expect(chips[0]).toEqual({ chip: { kind: 'words', text: 'batman' }, without: intent({ media: 'movie', from: 1990, to: 1999 }) });
  });

  it('knows when a reading has filters', () => {
    expect(hasFilters(intent({}))).toBe(false);
    expect(hasFilters(intent({ sort: 'top' }))).toBe(true);
  });
});

describe('intentStands', () => {
  it('gives way to a title called exactly that', () => {
    expect(intentStands('Romantic Comedy', [{ name: 'Romantic Comedy' }])).toBe(false);
    expect(intentStands('something like summer', [{ name: 'Something Like Summer' }])).toBe(false);
    expect(intentStands('best horror movies', [{ name: 'The Best Horror Movies Ever Made: A Documentary' }])).toBe(true);
  });
});

describe('inYears', () => {
  it('checks a title’s first year', () => {
    expect(inYears({ year: '1995' }, { from: 1990, to: 1999 })).toBe(true);
    expect(inYears({ year: '2010–2015' }, { from: 2011 })).toBe(false);
    expect(inYears({ year: undefined }, { to: 1999 })).toBe(false);
    expect(inYears({ year: undefined }, {})).toBe(true);
  });
});

describe('intentFilters', () => {
  it('builds TMDB discover filters', () => {
    expect(intentFilters(intent({ genres: ['horror'], sort: 'top' }), 'movie', '2026-10-05')).toEqual({ sort: 'vote_average.desc', filters: { withGenres: '27', voteCountGte: 1000 } });
    expect(intentFilters(intent({ genres: ['comedy'], from: 2010, to: 2019, sort: 'top' }), 'series', '2026-10-05')).toEqual({
      sort: 'vote_average.desc',
      filters: { withGenres: '35', releaseDateGte: '2010-01-01', releaseDateLte: '2019-12-31', voteCountGte: 80 },
    });
    expect(intentFilters(intent({ language: 'ko', sort: 'new' }), 'movie', '2026-10-05')).toEqual({ sort: 'primary_release_date.desc', filters: { withOriginalLanguage: 'ko', voteCountGte: 20, releaseDateLte: '2026-10-05' } });
    expect(intentFilters(intent({ country: 'GB' }), 'series', '2026-10-05')).toEqual({ sort: 'popularity.desc', filters: { withOriginCountry: 'GB', voteCountGte: 20 } });
  });

  it('uses TV’s combined genres for shows', () => {
    expect(intentFilters(intent({ genres: ['action'] }), 'series', '2026-10-05')?.filters.withGenres).toBe('10759');
    expect(intentFilters(intent({ genres: ['scifi', 'fantasy'] }), 'series', '2026-10-05')?.filters.withGenres).toBe('10765');
  });

  it('reads anime as Japanese animation', () => {
    expect(intentFilters(intent({ anime: true }), 'series', '2026-10-05')?.filters).toMatchObject({ withGenres: '16', withOriginalLanguage: 'ja' });
  });

  it('limits runtimes, keeping films feature length when the limit allows', () => {
    expect(intentFilters(intent({ maxRuntime: 90 }), 'movie', '2026-10-05')?.filters).toMatchObject({ runtimeLte: 90, runtimeGte: 60 });
    expect(intentFilters(intent({ maxRuntime: 45 }), 'movie', '2026-10-05')?.filters).toMatchObject({ runtimeLte: 45, runtimeGte: 1 });
    expect(intentFilters(intent({ maxRuntime: 'short' }), 'series', '2026-10-05')?.filters).toMatchObject({ runtimeLte: 30, runtimeGte: 1 });
  });

  it('refuses genres shows don’t have', () => {
    expect(intentFilters(intent({ genres: ['horror'] }), 'series', '2026-10-05')).toBeNull();
  });
});
