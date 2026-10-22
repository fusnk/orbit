import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // Překryv při přetahování souborů nad okno
  'local.drop.title': 'Pusťte pro přehrání',
  'local.drop.video-hint': 'Video se přehraje v Orbitu.',
  'local.drop.subtitle-hint': 'Titulky se přidají k tomu, co se přehrává.',
  'local.drop.first-only': 'Přehrává se {name}. Orbit přehrává jeden soubor najednou, takže ostatní byly vynechány.',
  'local.drop.failed': 'Tento soubor se nepodařilo otevřít.',
  'local.drop.unsupported': 'Tento druh souboru Orbit neumí přehrát.',
  'local.drop.subtitle-needs-player': 'Nejdřív spusťte video a pak na něj přetáhněte titulky.',
  'local.drop.subtitle-added': 'Titulky přidány: {name}',
  'local.drop.subtitle-first-only': 'Titulky přidány: {name}. Použil se jen první soubor.',
  'local.drop.subtitle-failed': 'Tyto titulky se nepodařilo přidat.',
  // Přetažený soubor v přehrávači („Načítání z {addon}…“)
  'local.source.addon': 'tohoto počítače',
  'local.source.label': 'Místní soubor',
  // Nastavení → Přehrávač → Externí přehrávač
  'local.external.heading': 'Externí přehrávač',
  'local.external.player': 'Otevírat zdroje v',
  'local.external.player-hint': 'Přidá k webovým zdrojům ve výběru zdroje volbu „Otevřít v externím přehrávači“. Pokračování, přeskočení úvodu, zapamatované stopy a průběh sledování fungují jen ve vlastním přehrávači Orbitu.',
  'local.external.none': 'Žádný',
  'local.external.custom': 'Vlastní',
  'local.external.found': 'Nalezeno: {path}',
  'local.external.not-found': 'Ve své obvyklé instalační složce nenalezen. Zvolte Vlastní a zadejte jeho umístění.',
  'local.external.custom-path': 'Program',
  'local.external.custom-path-hint': 'Programový soubor přehrávače, vybraný na tomto počítači.',
  'local.external.choose': 'Vybrat…',
  'local.external.custom-invalid': 'Orbit to nemůže spustit. Vyberte programový soubor přehrávače.',
  'local.external.always': 'Vždy otevírat v externím přehrávači',
  'local.external.always-hint': 'Přehrát předá nejlepší webový zdroj rovnou jemu. Torrenty a stažené soubory se dál přehrávají v Orbitu.',
  // Výběr zdroje
  'local.external.open': 'Externě',
  'local.external.open-label': 'Otevřít v externím přehrávači',
  'local.external.opened': 'Otevřeno v externím přehrávači.',
  'local.external.failed': 'Externí přehrávač se nespustil. Zkontrolujte Nastavení → Přehrávač.',
};
