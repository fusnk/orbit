import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoiler',
  'spoilers.intro': 'Cosa nascondere degli episodi: nella pagina di una serie, nell’elenco episodi del lettore, nella scheda Prossimo e in Continua a guardare.',
  'spoilers.titles': 'Nascondi i titoli degli episodi',
  'spoilers.titles-hint': 'Mostra «Episodio 4» al posto del nome dell’episodio.',
  'spoilers.descriptions': 'Nascondi le descrizioni degli episodi',
  'spoilers.descriptions-hint': 'Omette il riassunto di ogni episodio.',
  'spoilers.thumbnails': 'Sfoca le immagini degli episodi',
  'spoilers.thumbnails-hint': 'Passa il mouse o seleziona un episodio per sbirciare.',
  'spoilers.ratings': 'Nascondi le valutazioni degli episodi',
  'spoilers.ratings-hint': 'Una valutazione può rivelare quali episodi contano.',
  'spoilers.unaired': 'Nascondi le date di uscita dei prossimi episodi',
  'spoilers.unaired-hint': 'Gli episodi non ancora usciti dicono solo «Non ancora trasmesso».',
  'spoilers.scope': 'Si applica a',
  'spoilers.scope-hint': 'Gli episodi che hai finito o iniziato mostrano tutto, a meno che tu non scelga tutti gli episodi.',
  'spoilers.scope-unwatched': 'Episodi che non ho visto',
  'spoilers.scope-all': 'Tutti gli episodi',
};
