import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

export const pstreamPlayer: Catalog<typeof source> = {
  // Zkratky rychlosti a jemného přetáčení
  'pstream.keys.speed-down': 'Pomaleji',
  'pstream.keys.speed-up': 'Rychleji',
  'pstream.keys.seek-back-small': 'Zpět o 1 sekundu (při pozastavení o snímek)',
  'pstream.keys.seek-forward-small': 'Vpřed o 1 sekundu (při pozastavení o snímek)',
  // Obrazovka pozastavení
  'pstream.pause.ends': 'Skončí v {time}',
  // Vrácení po přeskočení
  'pstream.skip.back': 'Zpět na {time}',
  // Části k přeskočení v zobrazení Kapitoly
  'pstream.chapters.segments': 'Části, které lze přeskočit',
  'pstream.chapters.to-end': '{from} – konec',
  // Panel dílů a ukotvený seznam
  'pstream.episodes.mark-watched': 'Označit {episode} jako zhlédnuté',
  'pstream.episodes.mark-unwatched': 'Označit {episode} jako nezhlédnuté',
  'pstream.episodes.watched': 'Zhlédnuto',
  // Řádky titulků z doplňků
  'pstream.subs.sdh': 'Pro neslyšící',
  'pstream.subs.match-good': 'Dobrá shoda',
  'pstream.subs.match-fair': 'Ucházející shoda',
  'pstream.subs.match-poor': 'Slabá shoda',
  // Zadání časování
  'pstream.timing.field': '{name}, v sekundách',
  'pstream.timing.type': '{name}: {value}. Aktivací zadáte hodnotu',
  'pstream.timing.invalid': 'Zadejte sekundy, například 1,5 nebo -2',
  // Časování titulků pro každý soubor titulků
  'pstream.timing.reset': 'Časování titulků obnoveno pro nové titulky',
  // Styl titulků v přehrávači
  'pstream.style.title': 'Styl titulků',
  'pstream.style.position': 'Umístění',
  'pstream.style.custom': 'Vlastní…',
  'pstream.style.hex': 'Kód barvy, například #ffcc00',
  'pstream.style.caps-note': 'Platí pro titulky přidané od teď.',
  'pstream.style.more': 'Neprůhlednost textu, barva a neprůhlednost rámečku a barva obrysu jsou v Nastavení → Titulky.',
  // Obrazovka chyby přehrávání
  'pstream.error.retry': 'Zkusit znovu',
  'pstream.error.retry-at': 'Zkusit znovu od {time}',
  'pstream.error.copy': 'Kopírovat podrobnosti',
  'pstream.error.copied': 'Podrobnosti zkopírovány. Adresy a klíče byly vynechány.',
  'pstream.error.copy-failed': 'Podrobnosti se nepodařilo zkopírovat',
  // Nastavení → Přehrávač
  'pstream.settings.double-click': 'Dvojklikem na okraje skákat',
  'pstream.settings.double-click-hint': 'Dvojklik na levou nebo pravou třetinu obrazu skočí zpět nebo vpřed o délku skoku. Prostředek dál přepíná celou obrazovku.',
};
