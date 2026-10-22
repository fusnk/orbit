import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Tempi di salto anime da AniSkip",
  'movix.aniskip-hint': "Per gli anime chiede anche ad AniSkip, un database comunitario gratuito, dove sono opening, ending e riassunti. Invia solo l’ID MyAnimeList della serie e il numero dell’episodio; per riconoscere la serie può scaricare un elenco pubblico di ID da GitHub. Disattivato finché non lo attivi.",
  'movix.smooth': "Salto in dissolvenza",
  'movix.smooth-hint': "Durante un salto l’immagine sfuma al nero e l’audio si abbassa per un attimo, poi tornano. Con Riduci animazioni attivo, i salti restano istantanei.",
  'movix.button-delay': "Mostra il pulsante Salta dopo",
  'movix.button-delay-hint': "Lascia scorrere l’inizio della sigla o dei titoli di coda prima che compaia Salta, così il pulsante non copre la fine di una scena. I salti automatici non aspettano.",
  'movix.button-delay-none': "Subito",
  'movix.landing': "Riprendi prima della fine",
  'movix.landing-hint': "Il salto si ferma un po’ prima della fine della sigla o del riassunto, per non tagliare il primo momento successivo. I titoli di coda che arrivano alla fine portano sempre alla fine.",
  'movix.landing-none': "Alla fine",
  'movix.color-intro': "Colore della sigla",
  'movix.color-recap': "Colore del riassunto",
  'movix.color-credits': "Colore dei titoli di coda",
  'movix.color-preview': "Colore dell’anteprima",
  'movix.colors-hint': "L’aspetto di ogni parte sulla barra di avanzamento.",
  'movix.swatch.default': "Standard",
  'movix.swatch.amber': "Ambra",
  'movix.swatch.sky': "Azzurro",
  'movix.swatch.mint': "Menta",
  'movix.swatch.rose': "Rosa",
  'movix.swatch.violet': "Viola",
  'movix.swatch.white': "Bianco",
};
