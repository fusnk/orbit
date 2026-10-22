import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Limity autoodtwarzania',
  'sources.limits.any': 'Dowolna',
  'sources.limits.min-quality': 'Autoodtwarzanie nie startuje poniżej',
  'sources.limits.min-quality-hint': 'Odtwórz i następny odcinek uruchamiają tylko źródła co najmniej tej jakości (źródła bez podanej jakości nie). Jeśli żadne nie pasuje, odtwarzane jest najlepsze, a Orbit o tym informuje. Lista źródeł nadal pokazuje wszystko. Dla tego profilu.',
  'sources.limits.max-quality': 'Autoodtwarzanie nie startuje powyżej',
  'sources.limits.max-quality-hint': 'Odtwórz i następny odcinek nie uruchamiają źródeł powyżej tej jakości, chyba że nie ma nic innego. W przeciwieństwie do „Najwyższa preferowana jakość” nie zmienia kolejności listy źródeł. Dla tego profilu.',
  'sources.limits.max-size': 'Autoodtwarzanie nie uruchamia plików większych niż',
  'sources.limits.max-size-hint': 'Przy wolnym łączu lub limicie danych: Odtwórz i następny odcinek pomijają większe pliki. Nie dotyczy źródeł, które nie podają rozmiaru. Dla tego profilu.',
  'sources.autoplay.outside-limits': 'Nic nie mieści się w limitach autoodtwarzania, więc odtwarzane jest najlepsze źródło.',
  'sources.autoplay.only-uncached': 'Wszystkie znalezione źródła wciąż pobierają się do Twojej usługi debrid. Wybierz jedno, aby je uruchomić.',
  'sources.note.uncached': 'Poza cache',
  'sources.note.uncached-hint': 'Wciąż pobiera się do Twojej usługi debrid: nigdy nie uruchamia się automatycznie',
  'sources.note.outside-limits': 'Poza limitami',
  'sources.note.outside-limits-hint': 'Odtwórz i następny odcinek je pomijają (Ustawienia → Dodatki i źródła → Preferencje źródeł → Limity autoodtwarzania)',
  'sources.next-up.unaired': 'Następny · data emisji niepotwierdzona',
};
