import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

export const wins: Catalog<typeof source> = {
  // Filtry v Objevovat: rozsah let, délka, herci a režisér
  'explore.filters.year-from': 'Od',
  'explore.filters.year-to': 'Do',
  'explore.filters.runtime': 'Délka',
  'explore.filters.runtime-min': 'Nejméně',
  'explore.filters.runtime-max': 'Nejvýše',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Herci',
  'explore.filters.director': 'Režie nebo štáb',
  'explore.filters.person-search': 'Hledat osoby: {what}',
  'explore.filters.person-placeholder': 'Napište jméno',
  'explore.filters.person-none': 'Nikdo nenalezen',
  'explore.filters.person-clear': 'Odebrat {name}',
  // Nastavení → Přehrávání → Mezipaměť pro přetáčení
  'settings.player.rewind': 'Mezipaměť pro přetáčení',
  'settings.player.rewind-hint': 'Kolik videa zůstává v paměti, aby byl skok zpět okamžitý. Více použije během přehrávání až asi 600 MB RAM, Nejvíce až asi 1,5 GB. Platí od dalšího videa.',
  'settings.player.rewind-standard': 'Standardní',
  'settings.player.rewind-more': 'Více',
  'settings.player.rewind-most': 'Nejvíce',
  // Nastavení → Titulky: průhlednost, barvy rámečku a obrysu
  'subs.style.opacity': 'Neprůhlednost textu',
  'subs.style.box-colour': 'Barva rámečku',
  'subs.style.box-opacity': 'Neprůhlednost rámečku',
  'subs.style.box-opacity-hint': 'Rámeček má hranaté rohy: přehrávač neumí kreslit zaoblené.',
  'subs.style.outline-colour': 'Barva obrysu',
  'player.subtitle-style.black': 'Černá',
  'player.subtitle-style.grey': 'Šedá',
  'player.subtitle-style.navy': 'Námořnická modř',
  // Doplňky: stav, počty a obnovení manifestu
  'addons.health.no-answer': 'Neodpověděl',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} nainstalovaný',
  'addons.health.installed.few': '{count} nainstalované',
  'addons.health.installed.other': '{count} nainstalovaných',
  'addons.health.enabled.one': '{count} zapnutý',
  'addons.health.enabled.few': '{count} zapnuté',
  'addons.health.enabled.other': '{count} zapnutých',
  'addons.health.refresh': 'Obnovit doplněk',
  'addons.health.refreshing': 'Obnovování {name}…',
  'addons.health.refreshed': '{name} byl aktualizován.',
  'addons.health.unchanged': '{name} odpověděl: nic se nezměnilo.',
  'addons.health.refresh-failed': '{name} neodpověděl. Orbit dál používá to, co měl.',
  // Předvolby zdrojů: minimální velikost
  'sources.rules.min-size': 'Minimální velikost',
  'sources.rules.min-size-hint': 'Pro filmy; díly dostanou třetinu. Menší soubory, často podvrhy nebo kopie z kina, se zařadí za všechny ostatní, ale nikdy se neskryjí. Zdrojů, které velikost neuvádějí, se to netýká.',
  'titles.why.under-size': 'Pod vaším minimem {size} GB',
  // Hledání v kolekcích
  'collections.search.label': 'Najít kolekci',
  'collections.search.placeholder': 'Najít kolekci',
  'collections.search.none': 'Žádná kolekce neodpovídá',
  'collections.search.none-detail': 'Hledá se v názvech a skupinách.',
  'collections.search.titles-label': 'Najít titul v této kolekci',
  'collections.search.titles-placeholder': 'Najít titul',
  'collections.search.no-titles': 'Žádný titul tady neodpovídá',
  // Radar novinek → Export do kalendáře
  'radar.export': 'Exportovat do kalendáře (.ics)',
  'radar.export.hint': 'Uloží to, co Radar ukazuje, jako soubor, který umí importovat jakákoli kalendářová aplikace.',
  'radar.export.name': 'Radar novinek Orbit',
  // Automatické přeskočení po prodlevě
  'playerplus.skip.auto-in': '{label} za {seconds}',
  'playerplus.settings.skip-delay': 'Počkat před automatickým přeskočením',
  'playerplus.settings.skip-delay-hint': 'U částí nastavených na Automaticky: tlačítko Přeskočit nejdřív odpočítává. Stiskem libovolné klávesy ho zastavíte a díváte se dál.',
  'playerplus.settings.skip-delay-none': 'Bez čekání',
};
