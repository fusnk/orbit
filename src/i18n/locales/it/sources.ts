import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Limiti della riproduzione automatica',
  'sources.limits.any': 'Qualsiasi',
  'sources.limits.min-quality': 'La riproduzione automatica non parte sotto',
  'sources.limits.min-quality-hint': 'Riproduci e l’episodio successivo avviano solo fonti almeno di questa qualità (quelle che non la indicano no). Se nessuna va bene, viene riprodotta la migliore e Orbit te lo dice. L’elenco delle fonti mostra sempre tutto. Per questo profilo.',
  'sources.limits.max-quality': 'La riproduzione automatica non parte sopra',
  'sources.limits.max-quality-hint': 'Riproduci e l’episodio successivo non avviano fonti oltre questa, a meno che non ci sia altro. A differenza di «Qualità massima da preferire», non riordina l’elenco delle fonti. Per questo profilo.',
  'sources.limits.max-size': 'La riproduzione automatica non avvia file oltre',
  'sources.limits.max-size-hint': 'Per connessioni lente o traffico limitato: Riproduci e l’episodio successivo saltano i file più grandi. Le fonti che non indicano la dimensione non sono interessate. Per questo profilo.',
  'sources.autoplay.outside-limits': 'Niente rientra nei tuoi limiti di riproduzione automatica, quindi viene riprodotta la fonte migliore.',
  'sources.autoplay.only-uncached': 'Tutte le fonti trovate sono ancora in download sul tuo servizio debrid. Scegline una per avviarla.',
  'sources.note.uncached': 'Non in cache',
  'sources.note.uncached-hint': 'Ancora in download sul tuo servizio debrid: mai avviata automaticamente',
  'sources.note.outside-limits': 'Fuori dai limiti',
  'sources.note.outside-limits-hint': 'Riproduci e l’episodio successivo la saltano (Impostazioni → Componenti aggiuntivi e fonti → Preferenze fonti → Limiti della riproduzione automatica)',
  'sources.next-up.unaired': 'A seguire · data di messa in onda non confermata',
};
