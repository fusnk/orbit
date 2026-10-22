import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Italian strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Sfoglia',
  'remote.phone.browse-loading': 'Caricamento della tua Home…',
  'remote.phone.browse-empty': 'Ancora niente da mostrare. Aggiungi un componente aggiuntivo di catalogo in Orbit per riempire la Home.',
  'remote.phone.browse-failed': 'Impossibile caricare la tua Home. Riprova.',
  'remote.phone.refresh': 'Aggiorna',
  'remote.phone.moods': 'Cosa ti va di guardare?',
  'remote.phone.mood-loading': 'Ricerca di suggerimenti…',
  'remote.phone.mood-empty': 'Nessun suggerimento per questo umore al momento.',
  'remote.phone.surprise': 'Sorprendimi',
  'remote.phone.surprise-hint': 'Un suggerimento a caso dai tuoi cataloghi.',
  'remote.phone.surprise-movie': 'Un film',
  'remote.phone.surprise-series': 'Una serie',
  'remote.phone.surprise-none': 'Al momento non c’è niente di nuovo da suggerire. Prova l’altro tipo o cambia le scelte di Sorprendimi in Orbit.',
  'remote.phone.details-loading': 'Caricamento dei dettagli…',
  'remote.phone.details-failed': 'Impossibile caricare questo titolo. Riprova.',
  'remote.phone.add-library': 'Aggiungi alla libreria',
  'remote.phone.in-library': 'Nella tua libreria',
  'remote.phone.close': 'Chiudi',
  'remote.phone.season': 'Stagione {number}',
  'remote.phone.specials': 'Speciali',
  'remote.phone.episodes': 'Episodi',
  'remote.phone.rating': 'Voto IMDb {rating}',
};
