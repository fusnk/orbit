/**
 * Natural-language searches ("best horror movies 2020s", "korean thrillers",
 * "comedies under 90 minutes", "shows like Severance", "movies with Tom
 * Hanks") turned into filters Discover can answer. Kept pure so its guesses
 * can be tested. Words are known in every interface language (genre names
 * come from the translations, see `genreNames`).
 *
 * A search is only read this way when it says so clearly enough, so real
 * titles stay plain searches: "Heat", "Best in Show", "The Best of Me",
 * "Like Crazy", "Scary Movie", "That '90s Show". A singular "movie" or
 * "show" doesn't count as asking for a list (titles use it), a plural does.
 * The page also drops the reading when a title matches the search exactly.
 */
import { GENRES, type GenreKey } from './explore';
import { matchTier, normalize } from './search';
import type { Title } from './titles';

export type IntentMedia = 'movie' | 'series' | 'both';
export type IntentSort = 'popular' | 'top' | 'new';

/** What a search filters by. Years are inclusive; either end may be open. */
export interface IntentFilters {
  media: IntentMedia;
  /** Japanese animation: TMDB's Animation genre in Japanese. */
  anime: boolean;
  genres: GenreKey[];
  /** An original language (ISO 639-1). */
  language?: string | undefined;
  /** A country of origin (ISO 3166-1). */
  country?: string | undefined;
  from?: number | undefined;
  to?: number | undefined;
  /** The longest runtime in minutes, or 'short' (90 for films, 30 for episodes). */
  maxRuntime?: number | 'short' | undefined;
  sort: IntentSort;
}

export type DiscoverIntent = {
  kind: 'discover';
  /** Words that are none of the filters, searched for as a title ("batman" in "batman movies from the 90s"). */
  text: string;
} & IntentFilters;

export type SearchIntent =
  | DiscoverIntent
  /** Titles like another one, found by its name. */
  | { kind: 'like'; media: IntentMedia; title: string }
  /** A person's titles, found by their name. */
  | { kind: 'person'; media: IntentMedia; name: string };

/** Each list's words, normalized the way searches are, so they can be written with accents. */
const words = (list: string): string[] => list.split(',').map((w) => normalize(w)).filter(Boolean);
const table = <T>(entries: [string, T][]): Map<string, T> => new Map(entries.flatMap(([list, value]) => words(list).map((w) => [w, value] as [string, T])));
const alternation = (list: string) => words(list).sort((a, b) => b.length - a.length).join('|');

/** Genre words beyond the translated genre names: plurals and synonyms. */
const GENRE_WORDS = table<GenreKey>([
  ['action, боевики, бойовики', 'action'],
  ['adventure, adventures, aventuras, aventures, avventure', 'adventure'],
  ['animated, animation, cartoon, cartoons, animowane, dibujos animados, desenhos animados, dessins animés, cartoni animati, tekenfilms, tecknat, tecknade, animerade, kartun, мультфильмы, мультики, мультфільми, animované, kreslené, מצוירים', 'animation'],
  ['comedy, comedies, funny, comedias, komödien, commedie, komedies, komedie, komedier, комедии, комедії, קומדיות', 'comedy'],
  ['crime, policiers, krimis, kryminały, deckare, детективы, детективи', 'crime'],
  ['documentary, documentaries, docs, documentales, documentaires, documentários, dokumentationen, dokus, documentari, dokumentalne, dokumentärer, документальные, документальні, dokumenty', 'documentary'],
  ['drama, dramas, drames, dramen, drammi, dramaty, драмы, драми, dramata, דרמות', 'drama'],
  ['family, kids, children, infantiles, enfants, kinder, bambini, kinderen, dla dzieci, barn, anak anak, детские, дитячі, pro děti, pohádky, לילדים', 'family'],
  ['fantasy', 'fantasy'],
  ['history, historical, históricas, historiques, historische, storici', 'history'],
  ['horror, horrors, scary, horrory, skräck, seram, ужастики, хорроры, хорори, ужасов, жахів, horory, מפחידים', 'horror'],
  ['music, musical, musicals, musicales, comédies musicales, musicais, musikaler', 'music'],
  ['mystery, mysteries, misterios, mysterier', 'mystery'],
  ['romance, romances, romantic, romcom, románticas, romantiques, romantische, romantici, romantyczne, romantiska, мелодрамы, мелодрами, romantické, רומנטיים', 'romance'],
  ['scifi', 'scifi'],
  ['thriller, thrillers, suspense, thrillery, триллеры, трилери, מותחנים', 'thriller'],
  ['war, guerra, военные, воєнні, válečné', 'war'],
  ['western, westerns, westerny, вестерны, вестерни, מערבונים', 'western'],
]);

/** Genre words that are plural, which is a clear enough request on their own ("comedies"). */
const PLURAL_GENRES = new Set(
  words(
    'adventures, aventuras, aventures, avventure, cartoons, animowane, dibujos animados, desenhos animados, dessins animés, cartoni animati, tekenfilms, comedies, comedias, komödien, commedie, komedies, komedie, policiers, krimis, kryminały, documentaries, documentales, documentaires, documentários, dokumentationen, dokus, documentari, dokumentalne, dramas, drames, dramen, drammi, dramaty, horrors, horrory, musicals, musicales, comédies musicales, mysteries, misterios, romances, thrillers, thrillery, westerns, westerny, komedier, dokumentärer, deckare, tecknade, animerade, musikaler, mysterier, romantiska, мультфильмы, мультики, мультфільми, комедии, комедії, детективы, детективи, документальные, документальні, драмы, драми, ужастики, хорроры, хорори, мелодрамы, мелодрами, триллеры, трилери, вестерны, вестерни, боевики, бойовики, קומדיות, dokumenty, dramata, דרמות, horory, animované, kreslené, מצוירים, מותחנים, מערבונים',
  ),
);

/** First halves of compound genre words ("Horrorfilme", "oorlogsfilms"), where the genre name alone isn't one. */
const COMPOUND_GENRES = table<GenreKey>([
  ['liebes, kärleks', 'romance'],
  ['kriegs, oorlogs, krigs', 'war'],
  ['zeichentrick, trick, teken, tecknad', 'animation'],
  ['skräck', 'horror'],
  ['barn, familje', 'family'],
  ['äventyrs', 'adventure'],
  ['dokumentär', 'documentary'],
  ['dokumentar', 'documentary'],
  ['kinder', 'family'],
]);
/** Second halves of compound words, as media: plural or not. */
const COMPOUND_MEDIA: [string, Exclude<IntentMedia, 'both'>, boolean][] = [
  ['filmer', 'movie', true],
  ['filme', 'movie', true],
  ['films', 'movie', true],
  ['film', 'movie', false],
  ['serier', 'series', true],
  ['serien', 'series', true],
  ['series', 'series', true],
  ['serie', 'series', false],
];

/** Nationalities and languages, as the language titles were first made in. */
const LANGUAGE_WORDS = table<string>([
  ['korean, coreanas, coreanos, coreennes, coreens, koreanische, koreanischen, coreani, coreane, koreaanse, koreanskie, корейские, корейські, كورية, كوري, koreanska, korea, korejské, קוריאניים, קוריאני', 'ko'],
  ['japanese, japonesas, japoneses, japonais, japonaises, japanische, japanischen, giapponesi, japanse, japońskie, японские, японські, يابانية, ياباني, japanska, jepang, japonské, יפניים, יפני', 'ja'],
  ['french, francesas, franceses, français, françaises, französische, französischen, francesi, franse, francuskie, французские, французькі, فرنسية, فرنسي, franska, prancis, francouzské, צרפתיים, צרפתי', 'fr'],
  ['spanish, españolas, españoles, espagnols, espagnoles, spanische, spanischen, spagnoli, spaanse, hiszpańskie, испанские, іспанські, إسبانية, spanska, spanyol, španělské, ספרדיים', 'es'],
  ['italian, italianas, italianos, italiens, italiennes, italienische, italienischen, italiani, italiane, italiaanse, włoskie, итальянские, італійські, إيطالية, italienska, italia, italské, איטלקיים', 'it'],
  ['german, alemanas, alemanes, allemands, allemandes, deutsche, deutschen, tedeschi, tedesche, duitse, niemieckie, немецкие, німецькі, ألمانية, tyska, jerman, německé, גרמניים', 'de'],
  ['chinese, mandarin, cantonese, chinas, chinos, chinois, chinoises, chinesische, cinesi, chińskie, китайские, китайські, صينية, kinesiska, tiongkok, čínské, סיניים', 'zh'],
  ['hindi, bollywood', 'hi'],
  ['turkish, turcas, turcs, turques, türkische, turchi, turkse, tureckie, турецкие, турецькі, تركية, تركي, turkiska, turki, turecké, טורקיים', 'tr'],
  ['portuguese, portuguesas, portugais, portugiesische, portoghesi, portugese, portugalskie, португальские, португальські, برتغالية, portugisiska, portugis', 'pt'],
  ['swedish, schwedische, zweedse, szwedzkie, svenska, swedia, шведские, шведські', 'sv'],
  ['danish, dänische, deense, duńskie, danska, denmark, датские, данські', 'da'],
  ['norwegian, norwegische, noorse, norweskie, norska, norwegia, норвежские, норвезькі', 'no'],
  ['dutch, hollandaises, niederländische, olandesi, nederlandse, holenderskie, nederländska, holländska, belanda, голландские, нидерландские, нідерландські', 'nl'],
  ['polish, polacas, polonais, polnische, polacchi, poolse, polskie, polska, polandia, польские, польські, polské, פולניים', 'pl'],
  ['arabic, árabes, arabische, arabi, arabskie, арабские, арабські, عربية, عربي, arabiska, arab, arabské, ערביים', 'ar'],
  ['czech, czeskie, české, čeština, צ׳כיים', 'cs'],
  ['hebrew, israeli, hebrajskie, izraelskie, hebrejské, izraelské, ישראליים, ישראלי, עבריים, عبرية', 'he'],
  ['thai, tailandesas, thaïlandais, thailändische, thailandese, thaise, tajskie, thailändska, thailand, тайские, тайські', 'th'],
  ['russian, rusas, rusos, russes, russische, russi, rosyjskie, русские, российские, російські, روسية, ryska, rusia, ruské, רוסיים', 'ru'],
  ['indonesian, indonesiska, indonesia', 'id'],
]);

/** Countries whose films aren't told apart by language ("british" is English, like "american"). */
const COUNTRY_WORDS = table<string>([
  ['british, uk, británicas, britanniques, britische, britannici, britse, brytyjskie, британские, британські, بريطانية, brittiska, inggris', 'GB'],
  ['american, hollywood, usa, americanas, américains, américaines, amerikanische, americani, amerikaanse, amerykańskie, американские, американські, أمريكية, amerikanska, amerika', 'US'],
  ['indian, indias, indiens, indische, indiani, indiase, indyjskie, индийские, індійські, هندية, هندي, indiska, india', 'IN'],
  ['australian, australische, australiska', 'AU'],
  ['canadian, canadiens, kanadische, kanadensiska, kanada', 'CA'],
  ['irish, irlandaises, irische, irländska, irlandia', 'IE'],
  ['mexican, mexicanas, mexicanos, mexicains, mexikanische, messicani, mexicaanse, meksykańskie, مكسيكية, mexikanska, meksiko', 'MX'],
  ['brazilian, brasileñas, brasileiros, brasileiras, brésiliens, brasilianische, brasiliani, braziliaanse, brazylijskie, brasilianska, brasil', 'BR'],
  ['argentine, argentinian, argentinas, argentinos, argentins, argentinska', 'AR'],
  ['egyptian, egipcias, égyptiens, ägyptische, egiziani, مصرية, مصري, egyptiska, mesir', 'EG'],
  ['nollywood, nigerian', 'NG'],
]);

/** Media words, with whether each is plural (asking for a list) or singular (common in titles). */
const MEDIA_WORDS = table<[Exclude<IntentMedia, 'both'>, boolean]>([
  ['movies, films, tvfilms, películas, filmes, filme, filmy, filmer, фильмы, фільми, أفلام, סרטים, סרטי', ['movie', true]],
  ['movie, film, película, фильм, фільм, فيلم, סרט', ['movie', false]],
  ['shows, series, tvshows, tv, serien, seriale, seriales, seriados, serier, сериалы, серіали, مسلسلات, seriály, סדרות', ['series', true]],
  ['show, serie, serial, сериал, серіал, مسلسل, סדרה', ['series', false]],
]);

const SORT_WORDS = table<IntentSort>([
  ['best, top, toprated, greatest, acclaimed, classic, classics, good, great', 'top'],
  ['mejores, mejor, meilleurs, meilleures, meilleur, melhores, melhor, beste, besten, migliori, miglior, najlepsze, najlepsi, najlepszy, bästa, terbaik, лучшие, лучший, найкращі, найкращий, أفضل, nejlepší, nejlépe, הטובים, הטובות, הכי טובים', 'top'],
  ['popular, trending, populares, populaires, beliebte, beliebten, beliebteste, popolari, populaire, popularne, populära, populer, terpopuler, популярные, популярні, شائعة, رائجة, populární, oblíbené, פופולריים, פופולריות', 'popular'],
  ['new, newest, latest, recent, nuevas, nuevos, recientes, nouveaux, nouvelles, nouveau, récents, novos, novas, recentes, neue, neuen, neueste, neuesten, nuovi, nuove, recenti, nieuwe, nieuwste, nowe, najnowsze, nya, nyaste, senaste, terbaru, новые, новинки, нові, جديدة, أحدث, nové, nejnovější, חדשים, חדשות, החדשים', 'new'],
]);

const ANIME_WORDS = new Set(words('anime, animes, аниме, аніме, أنمي, אנימה'));

/** "Short" and "quick" ones: under 90 minutes for films, 30 for episodes. */
const SHORT_WORDS = new Set(words('short, quick, cortas, cortos, courts, courtes, curtos, curtas, kurze, kurzen, brevi, korte, krótkie, korta, pendek, короткие, короткі, قصيرة, krátké, קצרים, קצרות'));

/** Words that join the others without meaning anything here. */
const FILLER = new Set(
  words(
    // English, Spanish, French, Portuguese, German, Italian, Dutch, Polish, Czech, Swedish, Indonesian, Russian, Ukrainian, Arabic, Hebrew
    'the, of, from, in, all, time, ever, some, to, watch, and, a, for, with, about, ' +
      'de, del, la, las, los, el, en, y, para, ver, todos, ' +
      'des, du, le, les, et, a, voir, tous, d, l, ' +
      'do, da, dos, das, em, e, os, as, o, para, assistir, ' +
      'der, die, das, den, aus, und, von, im, zum, alle, ' +
      'di, dei, delle, degli, il, i, gli, e, da, tutti, dell, dall, ' +
      'het, een, van, uit, alle, ' +
      'z, i, w, ze, wszech, czasów, ' +
      've, s, na, všech, dob, ' +
      'från, på, och, alla, tiders, att, se, för, om, ' +
      'dari, di, dan, yang, semua, masa, sepanjang, untuk, ' +
      'и, все, всех, времен, в, из, і, й, та, усіх, часів, ' +
      'من, و, في, كل, الأوقات, ' +
      'של, עם, ו, ביותר, כל, הזמנים',
  ),
);

/** Searches that open with these name a title to find others like. */
const LIKE_MEDIA = alternation(
  'movies, movie, films, film, shows, show, series, tv shows, tv series, something, anything, ' +
    'películas, película, serie, algo, ' +
    'quelque chose, un truc, ' +
    'filmes, filme, ' +
    'serien, etwas, ' +
    'qualcosa, ' +
    'iets, ' +
    'filmy, seriale, coś, ' +
    'seriály, seriál, něco, ' +
    'filmer, serier, något, ' +
    'serial, sesuatu, ' +
    'фильмы, фильм, сериалы, сериал, что нибудь, фільми, фільм, серіали, серіал, щось, ' +
    'أفلام, فيلم, مسلسلات, مسلسل, شيء, ' +
    'סרטים, סרט, סדרות, סדרה, משהו',
);
const LIKE_WORDS = alternation(
  'like, similar to, ' +
    'como, parecidas a, parecidos a, similares a, parecidos com, parecidas com, semelhantes a, ' +
    'comme, similaires a, du genre, ' +
    'wie, ähnlich wie, ähnliche wie, ' +
    'come, simili a, tipo, ' +
    'zoals, als, vergelijkbaar met, ' +
    'jak, podobne do, ' +
    'jako, podobné jako, ' +
    'som, liknande, ' +
    'seperti, mirip, mirip dengan, ' +
    'как, похожие на, похожий на, як, схожі на, схожий на, ' +
    'مثل, تشبه, ' +
    'כמו, דומים ל',
);
/** "Like" phrases that need no media word before them. */
const LIKE_ALONE = alternation('similar to, more like, más como, plus comme, mehr wie, più come, meer zoals, więcej jak, mer som, lebih seperti, víc jako, עוד כמו');
const LIKE = new RegExp(`^(?:(${LIKE_MEDIA}) (?:${LIKE_WORDS})|${LIKE_ALONE}) (.+)$`);

const WITH_MEDIA = '(?:movies?|films?|shows?|series|tv shows?|tv series|something|anything)';
const WITH = new RegExp(`^(?:(${WITH_MEDIA}) (?:with|starring|featuring)|starring) (.+)$`);

/** Which kind a phrase's media word names, if any. */
function mediaOf(text: string | undefined): IntentMedia {
  const word = text ? MEDIA_WORDS.get(text.split(' ').at(-1)!) : undefined;
  if (word) return word[0];
  if (text && /^tv\b/.test(text)) return 'series';
  return 'both';
}

const YEAR = '((?:18|19|20)\\d\\d)';
const DECADE = '(\\d0|(?:19|20)\\d0)';
const UNDER = alternation(
  'under, less than, shorter than, below, max, at most, up to, within, ' +
    'menos de, de menos de, ' +
    'moins de, de moins de, ' +
    'unter, kürzer als, weniger als, höchstens, ' +
    'meno di, sotto i, sotto, ' +
    'onder, minder dan, korter dan, ' +
    'poniżej, krócej niż, mniej niż, do, ' +
    'pod, kratší než, méně než, ' +
    'kortare än, mindre än, högst, ' +
    'kurang dari, di bawah, maksimal, ' +
    'до, меньше, короче, менее, менше, коротше, ' +
    'أقل من, ' +
    'פחות מ, עד',
);
const MINUTES = alternation('m, min, mins, minute, minutes, minutos, minuten, minuti, minut, minuty, minuter, menit, мин, минут, минуты, хв, хвилин, хвилини, دقيقة, دقائق, minuta, דקות, דק');
const HOURS = alternation('h, hr, hrs, hour, hours, hora, horas, heure, heures, stunde, stunden, ora, ore, uur, godzina, godziny, godzin, timme, timmar, jam, час, часа, часов, година, години, годин, ساعة, ساعات, hodina, hodiny, hodin, שעה, שעות');
const OR_LESS = alternation('or less, max, maximum, ou moins, o menos, ou menos, oder weniger, o meno, of minder, lub mniej, eller mindre, atau kurang, أو أقل, nebo méně, או פחות');
const SINCE = alternation('since, from, after, desde, depois de, después de, depuis, après, seit, ab, nach, dal, dopo il, dopo, sinds, vanaf, na, od, po, från, efter, sedan, dari, sejak, setelah, с, после, з, після, منذ, من, بعد, מאז, אחרי');
/** Of SINCE, the ones that exclude the year itself. */
const AFTER = new Set(words('after, depois de, después de, après, nach, dopo il, dopo, na, po, efter, setelah, после, після, بعد, אחרי'));
/** Of SINCE, the ones that only mean "from": "from the 90s" is the decade, not since then. */
const FROM = new Set(words('from, från, dari, من'));
/** Before a year (that year excluded), and until one (included). */
const BEFORE = alternation('before, antes de, avant, vor, prima del, prima, voor, przed, före, innan, sebelum, قبل, před, לפני');
const UNTIL = alternation('until, till, hasta, até, jusqu en, bis, fino al, tot, fram till, sampai, hingga, حتى');
const RANGE_FROM = alternation('from, between, de, entre, von, zwischen, dal, tra, van, tussen, od, mellan, antara, с, от, від, з, من, بين');
const RANGE_TO = alternation('to, and, until, till, a, au, et, e, y, bis, und, al, tot, en, do, och, sampai, hingga, dan, по, до, إلى, و');
const DECADE_WORDS = alternation('años, années, anni, jaren, lat, lata, latach, década de, década de los, decennio, decennia, שנות ה, שנות, משנות ה, משנות');
/** Decades in words. */
const DECADE_NAMES = table<number>([
  ['fifties, الخمسينات, الخمسينيات', 50],
  ['sixties, الستينات, الستينيات', 60],
  ['seventies, siebziger, السبعينات, السبعينيات', 70],
  ['eighties, achtziger, الثمانينات, الثمانينيات', 80],
  ['nineties, neunziger, التسعينات, التسعينيات', 90],
  ['noughties', 0],
]);

/** Two digits of a decade ("80" the 1980s; "00" to "20" this century's). */
const decadeOf = (digits: string) => (digits.length === 4 ? Number(digits) : Number(digits) >= 30 ? 1900 + Number(digits) : 2000 + Number(digits));

/**
 * `body` as whole words. JavaScript's \b only knows ASCII letters, so
 * boundaries are spaces (normalized searches have nothing else between words).
 */
const phrase = (body: string) => new RegExp(`(?<![^ ])(?:${body})(?![^ ])`, 'g');

/** `~rt<minutes>` for a runtime that makes sense, else the words as they were. */
function runtimeToken(whole: string, n: string, unit: 'h' | 'm' | undefined): string {
  const minutes = unit === 'h' ? Number(n) * 60 : Number(n);
  // A bare number is only minutes when it looks like a runtime ("under 90", not "under 18").
  const plausible = unit ? minutes >= 10 && minutes <= 300 : minutes >= 30 && minutes <= 300;
  return plausible ? `~rt${minutes}` : whole;
}

type Replacer = (whole: string, ...groups: (string | undefined)[]) => string;

/**
 * Phrases read as one token before anything else: `~dec1990`, `~from2015`,
 * `~to1999`, `~rt90`. Their words are in every language above.
 */
const PHRASES: [RegExp, string | Replacer][] = [
  [phrase('sci fi|science fiction'), 'scifi'],
  [
    phrase(
      alternation(
        'top rated, highest rated, best rated, mejor valoradas, mejor valorados, mejor calificadas, mieux notés, les mieux notés, mais bem avaliados, mais bem avaliadas, melhor avaliados, am besten bewertet, am besten bewertete, bestbewertete, top bewertet, più votati, meglio recensiti, più apprezzati, best beoordeeld, best beoordeelde, hoogst gewaardeerde, najwyżej oceniane, najlepiej oceniane, högst rankade, bäst betygsatta, rating tertinggi, الأعلى تقييما',
      ),
    ),
    'toprated',
  ],
  [phrase(alternation('most popular, más populares, plus populaires, mais populares, più popolari, meest populaire, najpopularniejsze, mest populära, paling populer, الأكثر شعبية')), 'popular'],
  [phrase('rom coms?'), 'romcom'],
  [phrase('tv (?:shows|series)'), 'tvshows'],
  [phrase('tv (?:movies|films)'), 'tvfilms'],
  [phrase('k ?dramas?|drakor'), 'kdrama'],
  // Decades: "90s", "1990s", "80's" (normalized to "80 s"), "90er", "años 90", "the nineties".
  [phrase(`${DECADE} ?s`), (_, d) => `~dec${decadeOf(d!)}`],
  [phrase(`${DECADE}er(?: jahre| jahren)?`), (_, d) => `~dec${decadeOf(d!)}`],
  [phrase(`${DECADE} ?tal(?:et|s)?`), (_, d) => `~dec${decadeOf(d!)}`],
  [phrase(`(?:tahun )?${DECADE} ?an`), (_, d) => `~dec${decadeOf(d!)}`],
  // Russian and Ukrainian: "90-х", "1990-е годы", "90-ті" (normalized to "90 х").
  [phrase(`${DECADE} (?:х|е|ые|ті|ти)(?: годов| годы| років| роки)?`), (_, d) => `~dec${decadeOf(d!)}`],
  [phrase(`(?:${DECADE_WORDS}) ${DECADE}`), (_, d) => `~dec${decadeOf(d!)}`],
  [phrase(`(${[...DECADE_NAMES.keys()].join('|')})`), (_, w) => `~dec${decadeOf(String(DECADE_NAMES.get(w!)).padStart(2, '0'))}`],
  // Year ranges: "from 2010 to 2015", "2010-2015", "since 2015", "after 2010", "before 2000", "since the 90s".
  [phrase(`(?:${RANGE_FROM}) ${YEAR} (?:${RANGE_TO}) ${YEAR}`), (_, a, b) => `~from${a} ~to${b}`],
  [phrase(`${YEAR} ${YEAR}`), (whole, a, b) => (Number(b) > Number(a) ? `~from${a} ~to${b}` : whole)],
  [
    phrase(`(${SINCE}) (?:the )?(?:${YEAR}|~dec(\\d{4}))`),
    (_, word, year, decade) => (decade && FROM.has(word!) ? `~dec${decade}` : `~from${Number(year ?? decade) + (year && AFTER.has(word!) ? 1 : 0)}`),
  ],
  [phrase(`(?:${BEFORE}) (?:the )?(?:${YEAR}|~dec(\\d{4}))`), (_, year, decade) => `~to${Number(year ?? decade) - 1}`],
  [phrase(`(?:${UNTIL}) (?:the )?(?:${YEAR}|~dec(\\d{4}))`), (_, year, decade) => `~to${year ?? Number(decade) + 9}`],
  // Runtimes: "under 90 minutes", "less than 2 hours", "90 min or less", "under 90".
  [phrase(`(?:${UNDER}) (\\d{1,3}) ?(?:(${HOURS})|(${MINUTES}))?`), (whole, n, h, m) => runtimeToken(whole, n!, h ? 'h' : m ? 'm' : undefined)],
  [phrase(`(\\d{1,3}) ?(?:(${HOURS})|(${MINUTES})) (?:${OR_LESS})`), (whole, n, h, m) => runtimeToken(whole, n!, h ? 'h' : m ? 'm' : undefined)],
];

export interface ParseOptions {
  /** Genre names in every interface language, normalized ("horreur" → horror); see `genreNames`. */
  genreNames?: Readonly<Record<string, GenreKey>> | undefined;
  thisYear?: number | undefined;
}

/** Eastern Arabic digits as Western ones, so "٩٠" reads as 90. */
const westernDigits = (text: string) => text.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) % 16));

/** What a search asks for, or null for a plain title search. */
export function parseSearchIntent(query: string, options: ParseOptions = {}): SearchIntent | null {
  const raw = normalize(westernDigits(query));
  if (!raw || raw.length > 100) return null;

  const like = LIKE.exec(raw);
  if (like) return { kind: 'like', media: mediaOf(like[1]), title: like[2]!.trim() };
  const withMatch = WITH.exec(raw);
  if (withMatch) return { kind: 'person', media: mediaOf(withMatch[1]), name: withMatch[2]!.trim() };

  const names = options.genreNames ?? {};
  let text = raw;
  // Genre names of several words first ("ciencia ficcion", "dibujos animados").
  const genres = new Set<GenreKey>();
  let plural = false;
  const phrases = [...Object.entries(names), ...GENRE_WORDS].filter(([name]) => name.includes(' ')).sort((a, b) => b[0].length - a[0].length);
  for (const [name, key] of phrases) {
    // Normalized names are letters, digits and single spaces: nothing to escape.
    const found = new RegExp(`(^| )${name}( |$)`);
    if (found.test(text)) {
      genres.add(key);
      plural ||= PLURAL_GENRES.has(name);
      text = text.replace(found, ' ').trim();
    }
  }
  for (const [pattern, replacement] of PHRASES) text = typeof replacement === 'string' ? text.replace(pattern, replacement) : text.replace(pattern, replacement);

  const thisYear = options.thisYear ?? new Date().getFullYear();
  const genreOf = (word: string): GenreKey | undefined => GENRE_WORDS.get(word) ?? (Object.hasOwn(names, word) ? names[word] : undefined);
  let media: IntentMedia = 'both';
  let pluralMedia = 0;
  const sorts = new Set<IntentSort>();
  let language: string | undefined;
  let country: string | undefined;
  let from: number | undefined;
  let to: number | undefined;
  let maxRuntime: number | 'short' | undefined;
  let anime = false;
  let years = 0;
  const leftover: string[] = [];

  const setMedia = (kind: Exclude<IntentMedia, 'both'>, isPlural: boolean) => {
    if (media !== 'both' && media !== kind) return false;
    media = kind;
    if (isPlural) pluralMedia++;
    return true;
  };
  /** Narrows the years to `a`–`b`; false when that leaves none. */
  const narrow = (a: number | undefined, b: number | undefined) => {
    if (a !== undefined) from = from === undefined ? a : Math.max(from, a);
    if (b !== undefined) to = to === undefined ? b : Math.min(to, b);
    years++;
    return from === undefined || to === undefined || from <= to;
  };
  const setOnce = (current: string | undefined, next: string) => (current && current !== next ? null : next);

  for (const token of text.split(' ').filter(Boolean)) {
    // Arabic and Hebrew write "the" onto the word ("الرعب", "האימה"): try it without.
    const article = /^(ال|ה)\p{L}{2,}/u.exec(token);
    const candidates = article ? [token, token.slice(article[1]!.length)] : [token];
    const word = candidates.find((w) => known(w)) ?? token;
    const tokenMatch = /^~(dec|from|to|rt)(\d+)$/.exec(word);
    if (tokenMatch) {
      const n = Number(tokenMatch[2]);
      if (tokenMatch[1] === 'dec') {
        if (n > thisYear || !narrow(n, n + 9)) return null;
      } else if (tokenMatch[1] === 'from') {
        if (n > thisYear + 1 || !narrow(n, undefined)) return null;
      } else if (tokenMatch[1] === 'to') {
        if (!narrow(undefined, n)) return null;
      } else maxRuntime = n;
    } else if (genreOf(word)) {
      genres.add(genreOf(word)!);
      plural ||= PLURAL_GENRES.has(word);
    } else if (ANIME_WORDS.has(word)) {
      anime = true;
      plural = true;
    } else if (word === 'kdrama') {
      genres.add('drama');
      if (!setOnce(language, 'ko') || !setMedia('series', true)) return null;
      language = 'ko';
    } else if (LANGUAGE_WORDS.has(word)) {
      const next = setOnce(language, LANGUAGE_WORDS.get(word)!);
      if (!next) return null;
      language = next;
    } else if (COUNTRY_WORDS.has(word)) {
      const next = setOnce(country, COUNTRY_WORDS.get(word)!);
      if (!next) return null;
      country = next;
    } else if (MEDIA_WORDS.has(word)) {
      const [kind, isPlural] = MEDIA_WORDS.get(word)!;
      if (!setMedia(kind, isPlural)) return null;
    } else if (SORT_WORDS.has(word)) {
      sorts.add(SORT_WORDS.get(word)!);
    } else if (SHORT_WORDS.has(word)) {
      maxRuntime = 'short';
    } else if (/^(18|19|20)\d\d$/.test(word) && Number(word) <= thisYear + 1) {
      if (!narrow(Number(word), Number(word))) return null;
    } else if (compound(word)) {
      const [genre, kind, isPlural] = compound(word)!;
      genres.add(genre);
      if (!setMedia(kind, isPlural)) return null;
    } else if (!FILLER.has(word)) {
      leftover.push(token);
    }
  }

  /** Whether a word means something here (for trying Arabic and Hebrew words without "the"). */
  function known(w: string): boolean {
    return !!genreOf(w) || LANGUAGE_WORDS.has(w) || COUNTRY_WORDS.has(w) || MEDIA_WORDS.has(w) || SORT_WORDS.has(w) || SHORT_WORDS.has(w) || ANIME_WORDS.has(w);
  }
  /** A compound of a genre and a media word ("horrorfilme", "actiefilms"). */
  function compound(w: string): [GenreKey, Exclude<IntentMedia, 'both'>, boolean] | null {
    for (const [suffix, kind, isPlural] of COMPOUND_MEDIA) {
      if (!w.endsWith(suffix) || w.length < suffix.length + 3) continue;
      const head = w.slice(0, -suffix.length);
      const genre = genreOf(head) ?? COMPOUND_GENRES.get(head);
      if (genre) return [genre, kind, isPlural];
    }
    return null;
  }

  // "Best new movies": the best of the last two years.
  const sort: IntentSort = sorts.has('top') ? 'top' : sorts.has('new') ? 'new' : 'popular';
  if (sorts.has('top') && sorts.has('new') && from === undefined) {
    from = thisYear - 1;
    years++;
  }

  const topics = genres.size + (anime ? 1 : 0) + (language ? 1 : 0) + (country ? 1 : 0) + (years ? 1 : 0) + (maxRuntime !== undefined ? 1 : 0);
  const filters: IntentFilters = { media, anime, genres: [...genres], language, country, from, to, maxRuntime, sort };

  if (leftover.length) {
    // Other words are a title, filtered only by what titles say about themselves (their kind and year),
    // and only when the rest is unmistakably filters: "batman movies from the 90s", not "Dune 2021".
    const onlyKindAndYears = topics === (years ? 1 : 0) && !sorts.size;
    if (!onlyKindAndYears || !years || !pluralMedia) return null;
    return { kind: 'discover', text: leftover.join(' '), ...filters };
  }
  // Something to look for, said clearly enough: "horror" alone is a title search, "horror movies" isn't.
  const clear = topics > 0 ? pluralMedia > 0 || sorts.size > 0 || plural || topics >= 2 : sorts.size > 0 && pluralMedia > 0;
  if (!clear) return null;
  return { kind: 'discover', text: '', ...filters };
}

/** One filter of a reading, as Search shows it ("Showing: Horror · Movies · 2020s"). */
export type IntentChip =
  | { kind: 'words'; text: string }
  | { kind: 'like'; title: string }
  | { kind: 'genre'; genre: GenreKey }
  | { kind: 'anime' }
  | { kind: 'media'; media: Exclude<IntentMedia, 'both'> }
  | { kind: 'language'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'years'; from?: number | undefined; to?: number | undefined }
  | { kind: 'runtime'; max: number | 'short' }
  | { kind: 'sort'; sort: Exclude<IntentSort, 'popular'> };

export type LikeIntent = Extract<SearchIntent, { kind: 'like' }>;

/**
 * A reading's filters, each with the reading left once it's removed: null
 * when nothing would be left to filter by (the search is then plain again).
 */
export function intentChips(intent: DiscoverIntent | LikeIntent): { chip: IntentChip; without: SearchIntent | null }[] {
  if (intent.kind === 'like') {
    const chips: { chip: IntentChip; without: SearchIntent | null }[] = [{ chip: { kind: 'like', title: intent.title }, without: null }];
    if (intent.media !== 'both') chips.push({ chip: { kind: 'media', media: intent.media }, without: { ...intent, media: 'both' } });
    return chips;
  }
  const chips: { chip: IntentChip; without: DiscoverIntent }[] = [];
  if (intent.text) chips.push({ chip: { kind: 'words', text: intent.text }, without: { ...intent, text: '' } });
  for (const genre of intent.genres) chips.push({ chip: { kind: 'genre', genre }, without: { ...intent, genres: intent.genres.filter((g) => g !== genre) } });
  if (intent.anime) chips.push({ chip: { kind: 'anime' }, without: { ...intent, anime: false } });
  if (intent.media !== 'both') chips.push({ chip: { kind: 'media', media: intent.media }, without: { ...intent, media: 'both' } });
  if (intent.language) chips.push({ chip: { kind: 'language', code: intent.language }, without: { ...intent, language: undefined } });
  if (intent.country) chips.push({ chip: { kind: 'country', code: intent.country }, without: { ...intent, country: undefined } });
  if (intent.from !== undefined || intent.to !== undefined) chips.push({ chip: { kind: 'years', from: intent.from, to: intent.to }, without: { ...intent, from: undefined, to: undefined } });
  if (intent.maxRuntime !== undefined) chips.push({ chip: { kind: 'runtime', max: intent.maxRuntime }, without: { ...intent, maxRuntime: undefined } });
  if (intent.sort !== 'popular') chips.push({ chip: { kind: 'sort', sort: intent.sort }, without: { ...intent, sort: 'popular' } });
  // Words with nothing to filter them by are just a search for those words.
  return chips.map(({ chip, without }) => ({ chip, without: hasFilters(without) ? without : null }));
}

/** Whether a reading has any filter left (after some were removed). */
export function hasFilters(intent: DiscoverIntent): boolean {
  return intent.media !== 'both' || intent.anime || intent.genres.length > 0 || !!intent.language || !!intent.country || intent.from !== undefined || intent.to !== undefined || intent.maxRuntime !== undefined || intent.sort !== 'popular';
}

/** TMDB discover filters for a discover intent, for `kind`; null when TMDB can't answer it for that kind (a genre shows don't have). */
export function intentFilters(intent: IntentFilters, kind: 'movie' | 'series', today: string): { sort: string; filters: Record<string, string | number> } | null {
  const ids: number[] = [];
  const keys: GenreKey[] = intent.anime && !intent.genres.includes('animation') ? ['animation', ...intent.genres] : intent.genres;
  for (const key of keys) {
    const genre = GENRES.find((g) => g.key === key)!;
    const id = kind === 'movie' ? genre.movie : genre.tv;
    if (id === null) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  const filters: Record<string, string | number> = {};
  if (ids.length) filters.withGenres = ids.join(',');
  const language = intent.language ?? (intent.anime ? 'ja' : undefined);
  if (language) filters.withOriginalLanguage = language;
  if (intent.country) filters.withOriginCountry = intent.country;
  if (intent.from !== undefined) filters.releaseDateGte = `${intent.from}-01-01`;
  if (intent.to !== undefined) filters.releaseDateLte = `${intent.to}-12-31`;
  if (intent.maxRuntime !== undefined) {
    const max = intent.maxRuntime === 'short' ? (kind === 'movie' ? 90 : 30) : intent.maxRuntime;
    filters.runtimeLte = max;
    // Feature films only, when the limit allows one: shorts would otherwise lead "comedies under 90 minutes".
    filters.runtimeGte = kind === 'movie' && max >= 70 ? 60 : 1;
  }
  const narrowness = ids.length + (language ? 1 : 0) + (intent.country ? 1 : 0) + (intent.from !== undefined || intent.to !== undefined ? 1 : 0) + (intent.maxRuntime !== undefined ? 1 : 0);
  if (intent.sort === 'top') {
    // Enough votes that the average means something (fewer for shows and narrow searches, which get fewer).
    const narrow = narrowness > 1;
    filters.voteCountGte = kind === 'movie' ? (narrow ? 300 : 1000) : narrow ? 80 : 300;
    return { sort: 'vote_average.desc', filters };
  }
  filters.voteCountGte = 20;
  if (intent.sort === 'new') {
    filters.releaseDateLte = typeof filters.releaseDateLte === 'string' && filters.releaseDateLte < today ? filters.releaseDateLte : today;
    return { sort: 'primary_release_date.desc', filters };
  }
  return { sort: 'popularity.desc', filters };
}

/** Whether a title's year ("1995", "2010–2015") falls in the intent's years. */
export function inYears(title: Pick<Title, 'year'>, intent: Pick<IntentFilters, 'from' | 'to'>): boolean {
  const year = Number(title.year?.slice(0, 4));
  if (!year) return intent.from === undefined && intent.to === undefined;
  return (intent.from === undefined || year >= intent.from) && (intent.to === undefined || year <= intent.to);
}

/** Genre names, normalized, from translations of each genre's label, for `parseSearchIntent`. */
export function genreNames(labels: (key: GenreKey) => readonly string[]): Record<string, GenreKey> {
  const names: Record<string, GenreKey> = {};
  for (const { key } of GENRES) {
    for (const label of labels(key)) {
      const name = normalize(label);
      // A name two genres share in some language (none today) would be a guess: the first keeps it.
      if (name && !Object.hasOwn(names, name)) names[name] = key;
    }
  }
  return names;
}

/**
 * Whether a reading of the search should stand once its title results are
 * in: not when one of them is called exactly that ("Romantic Comedy",
 * "Something Like Summer"), since the person was then most likely looking for it.
 */
export function intentStands(query: string, titles: readonly Pick<Title, 'name'>[]): boolean {
  return !titles.some((title) => matchTier(title.name, query) <= 1);
}
