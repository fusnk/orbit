import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Přehrávač → Zvuk a titulky: titulky z doplňku vytvořené pro přehrávanou verzi
  'subs.best-match': 'Nejlepší shoda',
  'subs.error.sdh': 'Nastavení textu pro neslyšící se nepodařilo použít',
  // Nastavení → Zvuk a titulky
  'subs.settings.strip-sdh': 'Odstranit text pro neslyšící',
  'subs.settings.strip-sdh-hint': 'Skryje z titulků popisy zvuků jako [vrzají dveře], hudební značky a jména mluvčích jako JAN:. Prázdné řádky se přeskočí; časování zůstane stejné.',
  'subs.settings.keep-lyrics': 'Ponechat texty písní',
  'subs.settings.keep-lyrics-hint': 'Zpívané řádky označené ♪ zůstanou, i když se text pro neslyšící odstraní. Řádky jen s notami stejně zmizí.',
  // Přehrávač → Zvuk a titulky → Umístění titulků
  'subs.error.override': 'Titulky se nepodařilo udržet dole',
  'subs.player.position': 'Umístění titulků',
  'subs.player.height': 'Výška',
  'subs.player.raised': 'Výš o {value} %',
  'subs.player.reset': 'Vrátit dolů',
  'subs.player.keep-bottom': 'Držet dole',
  'subs.player.keep-bottom-hint': 'Prosté titulky (jako SRT) ignorují umístění ze souboru, takže každý řádek je v této výšce. Prosté titulky uvnitř videa navíc ztratí kurzívu. Stylované titulky (ASS, běžné u anime) si ponechají vlastní rozvržení. Zapamatuje se pro všechna videa.',
};
