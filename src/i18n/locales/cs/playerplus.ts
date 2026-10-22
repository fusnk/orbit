import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Rozcestník nastavení
  'playerplus.hub.title': 'Nastavení',
  'playerplus.hub.back': 'Zpět na {to}',
  'playerplus.hub.picture': 'Kvalita a obraz',
  'playerplus.hub.sound': 'Zvuk',
  'playerplus.hub.speed-note': 'Podržením {key} přehráváte dvojnásobnou rychlostí, dokud klávesu držíte.',
  'playerplus.hub.no-audio': 'Zatím žádné zvukové stopy. Objeví se, jakmile se video načte.',
  'playerplus.hub.timing-sub': 'Titulky {delay}',
  'playerplus.hub.timing-audio': 'Zvuk {delay}',
  'playerplus.hub.timing-none': 'Neupraveno',

  // Časování titulků podle toho, čeho jste si všimli
  'playerplus.timing.heard-first': 'Nejdřív jsem to slyšel(a)',
  'playerplus.timing.heard-first-hint': 'Titulky jdou pozdě: zobrazit je dřív',
  'playerplus.timing.saw-first': 'Nejdřív jsem to viděl(a)',
  'playerplus.timing.saw-first-hint': 'Titulky jdou brzy: zobrazit je později',
  'playerplus.timing.earlier-by': 'Zobrazit titulky o {value} s dříve',
  'playerplus.timing.later-by': 'Zobrazit titulky o {value} s později',

  // Zvuk
  'playerplus.sound.off': 'Původní',
  'playerplus.sound.off-hint': 'Zvuk tak, jak byl namíchán.',
  'playerplus.sound.cinema': 'Kino',
  'playerplus.sound.cinema-hint': 'Plnější basy a trochu víc prostoru, pro filmy při slušné hlasitosti.',
  'playerplus.sound.music': 'Hudba',
  'playerplus.sound.music-hint': 'Teplejší basy a jasnější výšky, pro koncerty a muzikály.',
  'playerplus.sound.dialogue': 'Čisté dialogy',
  'playerplus.sound.dialogue-hint': 'Hlasy vystoupí před hudbu a efekty.',
  'playerplus.sound.note': 'Jen jedno najednou. Zapamatuje se pro všechna videa.',

  // Živé hledání zdroje
  'playerplus.search.label': 'Hledání zdroje pro {name}',
  'playerplus.search.finding': 'Hledání doplňků…',
  'playerplus.search.asking': 'Dotazování…',
  'playerplus.search.sources.one': '{count} zdroj',
  'playerplus.search.sources.few': '{count} zdroje',
  'playerplus.search.sources.other': '{count} zdrojů',
  'playerplus.search.none': 'Žádné výsledky',
  'playerplus.search.failed': 'Neodpověděl',
  'playerplus.search.progress.one': 'Odpověděl {count} z {total} doplňků · zatím {found} zdrojů',
  'playerplus.search.progress.few': 'Odpověděly {count} z {total} doplňků · zatím {found} zdrojů',
  'playerplus.search.progress.other': 'Odpovědělo {count} z {total} doplňků · zatím {found} zdrojů',

  // Údaj o čase
  'playerplus.time.finish': 'Zbývá {left} · Konec v {time}',

  // Pásma na posuvníku
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'Úvod',
  'playerplus.bands.recap': 'Rekapitulace',
  'playerplus.bands.credits': 'Závěrečné titulky',
  'playerplus.bands.preview': 'Upoutávka',

  // Přeskakování
  'playerplus.skip.preview': 'Přeskočit upoutávku',
  'playerplus.skip.skipped-credits': 'Závěrečné titulky přeskočeny',
  'playerplus.skip.skipped-preview': 'Upoutávka přeskočena',

  // Bublina skoku
  'playerplus.bubble.ahead': '+{seconds} s',
  'playerplus.bubble.back': '−{seconds} s',

  // Seznam zkratek
  'playerplus.cheat.action': 'Zobrazit zkratky přehrávače',
  'playerplus.cheat.title': 'Zkratky přehrávače',
  'playerplus.cheat.playback': 'Přehrávání',
  'playerplus.cheat.sound': 'Zvuk a titulky',
  'playerplus.cheat.window': 'Obraz a okno',
  'playerplus.cheat.fixed': 'Vždy',
  'playerplus.cheat.no-key': 'Bez klávesy',
  'playerplus.cheat.hold': 'Podržet {key}',
  'playerplus.keys.number-jump': 'Skok na 0–90 % videa',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'Dvojnásobná rychlost, dokud držíte',
  'playerplus.keys.hold-boost-keys': 'Podržet {key}',

  // Zámek
  'playerplus.lock.action': 'Zamknout ovládání',
  'playerplus.lock.unlock': 'Odemknout',
  'playerplus.lock.hint': 'Ovládání je zamčené. Odemknete třikrát stisknutou klávesou Esc.',
  'playerplus.lock.hint-key': 'Ovládání je zamčené. Odemknete klávesou {key}, nebo třikrát stisknutou klávesou Esc.',
  'playerplus.lock.unlocked': 'Ovládání odemčeno',

  // Ukotvené díly
  'playerplus.dock.collapse': 'Skrýt díly',
  'playerplus.dock.expand': 'Zobrazit díly',
  'playerplus.dock.number': 'E{number}',

  // Nastavení → Přehrávač a Přehrávání
  'playerplus.settings.hold-boost': 'Podržením dvojnásobná rychlost',
  'playerplus.settings.hold-boost-hint': 'Podržení klávesy přehrát/pozastavit přehrává dvojnásobnou rychlostí, dokud ji nepustíte. Krátký stisk dál pozastavuje.',
  'playerplus.settings.number-jump': 'Skoky číselnými klávesami',
  'playerplus.settings.number-jump-hint': '1 skočí na 10 % videa, 5 do poloviny, 0 na začátek. Klávesy, kterým jste přiřadili jinou zkratku, si ji ponechají.',
  'playerplus.settings.grayscale': 'Černobíle při pozastavení',
  'playerplus.settings.grayscale-hint': 'Pozastavený obraz zešedne; barvy se vrátí, když se přehrávání rozběhne.',
  'playerplus.settings.episodes': 'Seznam dílů',
  'playerplus.settings.episodes-hint': 'Plovoucí se otevře přes ovládání. Ukotvený drží seznam vpravo, který se sbalí do malé záložky.',
  'playerplus.settings.episodes-floating': 'Plovoucí',
  'playerplus.settings.episodes-docked': 'Ukotvený',
  'playerplus.settings.skipping': 'Přeskakování',
  'playerplus.settings.skipping-hint': 'Tlačítko během přehrávání ukazuje Přeskočit; Automaticky přeskočí bez ptaní (jednou: přetočte zpět, pokud ho chcete vidět).',
  'playerplus.settings.skip-intro': 'Úvody',
  'playerplus.settings.skip-recap': 'Rekapitulace',
  'playerplus.settings.skip-credits': 'Závěrečné titulky',
  'playerplus.settings.skip-preview': 'Upoutávky po titulcích',
  'playerplus.settings.skip-off': 'Vypnuto',
  'playerplus.settings.skip-button': 'Tlačítko',
  'playerplus.settings.skip-auto': 'Automaticky',
  'playerplus.settings.learn-skips': 'Učit se, kde přeskakuji úvody',
  'playerplus.settings.learn-skips-hint': 'Když v seriálu ručně přeskočíte úvod, pozdější díly nabídnou Přeskočit úvod ve stejném čase, pokud nejsou známé jiné časy. Uchovává se na tomto zařízení pro tento profil.',
  'playerplus.settings.forget-skips': 'Naučené časy úvodů',
  'playerplus.settings.forget-skips-hint': 'Zapomene naučené časy úvodů pro všechny seriály v tomto profilu.',
  'playerplus.settings.forget-skips-action': 'Zapomenout',
  'playerplus.settings.forget-skips-done': 'Naučené časy úvodů zapomenuty',
};
