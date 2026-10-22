import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'Vlastní',
  'playertools.speed.custom-label': 'Vlastní rychlost',
  'playertools.speed.slower': 'Pomaleji (−0,05×)',
  'playertools.speed.faster': 'Rychleji (+0,05×)',
  'playertools.subs.try-another': 'Zkusit jiné titulky',
  'playertools.subs.try-another-detail': 'Další nejlepší shoda v jazyce: {language}',
  'playertools.subs.cycled': 'Titulky {position} z {total} · {source}',
  'playertools.subs.no-other': 'Žádné další titulky k vyzkoušení',
  'playertools.paste.action': 'Vložit titulky…',
  'playertools.paste.detail': 'Text SRT nebo WebVTT',
  'playertools.paste.title': 'Vložit titulky',
  'playertools.paste.hint': 'Vložte text souboru SRT nebo WebVTT. Přidá se jen k tomuto videu.',
  'playertools.paste.field': 'Text titulků',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nAhoj!',
  'playertools.paste.add': 'Přidat titulky',
  'playertools.paste.cancel': 'Zrušit',
  'playertools.paste.empty': 'Nejdřív vložte nějaký text titulků.',
  'playertools.paste.too-big': 'To je víc než 2 MB textu.',
  'playertools.paste.bad': 'Tohle nevypadá jako titulky SRT ani WebVTT.',
  'playertools.paste.added': 'Vložené titulky přidány',
  'playertools.paste.name': 'Vložené titulky',
  'playertools.caps.setting': 'Opravit titulky VELKÝMI PÍSMENY',
  'playertools.caps.hint': 'Řádky psané celé velkými písmeny se převedou na běžná písmena. Funguje u titulků z doplňků, přidaných souborů a vloženého textu, ne u titulků uvnitř videosouboru. Velká písmena ztratí i jména.',
  'playertools.caps.error': 'Nastavení pro titulky VELKÝMI PÍSMENY se nepodařilo použít',
};
