import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Bästa matchning',
  'subs.error.sdh': 'Kunde inte tillämpa inställningen för text för hörselskadade',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Ta bort text för hörselskadade',
  'subs.settings.strip-sdh-hint': 'Döljer ljudbeskrivningar som [dörr knarrar], musikmarkeringar och talarnamn som JOHN: i undertexterna. Rader som blir tomma hoppas över; synkningen förblir densamma.',
  'subs.settings.keep-lyrics': 'Behåll sångtexter',
  'subs.settings.keep-lyrics-hint': 'Sjungna rader markerade med ♪ behålls när text för hörselskadade tas bort. Rader med bara musiknoter tas ändå bort.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Kunde inte behålla undertexterna längst ned',
  'subs.player.position': 'Undertextposition',
  'subs.player.height': 'Höjd',
  'subs.player.raised': 'Upp {value} %',
  'subs.player.reset': 'Återställ till nederst',
  'subs.player.keep-bottom': 'Behåll längst ned',
  'subs.player.keep-bottom-hint': 'Enkla undertexter (som SRT) ignorerar placeringen från filen, så varje rad hamnar på den här höjden. Enkla undertexter inuti videon förlorar också sin kursivering. Formaterade undertexter (ASS, vanliga i anime) behåller sin egen layout. Sparas för alla videor.',
};
