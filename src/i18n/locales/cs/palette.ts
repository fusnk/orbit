import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'Paleta příkazů',
  'palette.placeholder': 'Hledat tituly, nastavení, doplňky a akce',
  // Nadpisy skupin
  'palette.group.recent': 'Nedávné',
  'palette.group.suggested': 'Navrhované',
  'palette.group.yours': 'Vaše věci',
  'palette.group.titles': 'Tituly',
  'palette.group.settings': 'Nastavení',
  'palette.group.addons': 'Doplňky',
  'palette.group.actions': 'Akce',
  // Tituly z doplňků během psaní
  'palette.titles.searching': 'Hledání ve vašich doplňcích…',
  'palette.titles.none': 'Žádné tituly nenalezeny',
  'palette.titles.none-can-search': 'Žádný z vašich doplňků neumí vyhledávat',
  'palette.titles.failed': 'Vaše doplňky teď nemohou vyhledávat',
  'palette.search-all': 'Hledat všechny výsledky pro „{query}“',
  'palette.no-match': '„{query}“ tu nic neodpovídá',
  // Kde se váš titul našel
  'palette.from.continue': 'Pokračovat ve sledování',
  'palette.from.library': 'Ve vaší knihovně',
  'palette.from.queue': 'Ve vaší frontě',
  'palette.from.downloads': 'Staženo',
  'palette.from.watched': 'Zhlédnuto',
  'palette.from.list': 'Seznam',
  // Co je výsledek
  'palette.kind.page': 'Stránka',
  'palette.kind.shortcut': 'Zkratka · {key}',
  'palette.kind.addon': 'Doplněk',
  'palette.kind.category': 'Nastavení',
  'palette.kind.setting': 'Nastavení · {category}',
  'palette.setting-hidden': '„{setting}“ se zobrazí, jakmile změníte „{parent}“.',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Seriál',
  'palette.kind.title': 'Titul',
  // Akce
  'palette.action.profile': 'Přepnout profil',
  'palette.action.shortcuts': 'Klávesové zkratky',
  'palette.action.install-addon': 'Nainstalovat doplněk…',
  'palette.action.addon-updates': 'Zkontrolovat aktualizace doplňků',
  // Nápověda kláves dole
  'palette.hint.move': 'Pohyb',
  'palette.hint.open': 'Otevřít',
  'palette.hint.groups': 'Další skupina',
  'palette.hint.close': 'Zavřít',
  // Další slova, která lidé mohou psát pro každou kategorii Nastavení
  'palette.keywords.general': 'jazyk spuštění otevřít zavřít okno lišta měřítko přiblížení pohyb efekty přístupnost upozornění oznámení záloha obnovení diagnostika protokoly import trakt letterboxd',
  'palette.keywords.playback': 'automatické přehrávání další díl pokračovat přeskočit úvod trailer',
  'palette.keywords.addons': 'instalovat obchod rozšíření pluginy zdroje kvalita torrenty vyhnout preferovat',
  'palette.keywords.downloads': 'offline úložiště složka kvalita stahování',
  'palette.keywords.appearance': 'motiv barvy zvýraznění písmo tmavý světlý tapeta ambientní logo vzhledy',
  'palette.keywords.shortcuts': 'klávesnice zkratky klávesy přemapovat',
  'palette.keywords.home-library': 'anime domů řádky zhlédnuté pokračovat spoilery dějové oblouky knihovna metadata',
  'palette.keywords.subtitles': 'titulky jazyk vynucené synchronizace neslyšící texty písní písmo velikost barva',
  'palette.keywords.picture-sound': 'obraz video hardwarové dekódování hdr zvuk jazyk passthrough hlasitost',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord streamovací služby synchronizace účet debrid tmdb integrace iptv živé vysílání kanály m3u xtream program',
  // Nastavení → Zkratky
  'palette.shortcut': 'Paleta příkazů',
};
