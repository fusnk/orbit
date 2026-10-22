import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Czasy pomijania anime z AniSkip",
  'movix.aniskip-hint': "W anime pyta też AniSkip, darmową bazę społeczności, gdzie są openingi, endingi i streszczenia. Wysyła tylko identyfikator MyAnimeList serii i numer odcinka; aby rozpoznać serię, może pobrać publiczną listę identyfikatorów z GitHuba. Wyłączone, dopóki tego nie włączysz.",
  'movix.smooth': "Płynne pomijanie",
  'movix.smooth-hint': "Przy pomijaniu obraz na chwilę przechodzi w czerń, a dźwięk cichnie, po czym oba wracają. Przy włączonym Ogranicz ruch pomijanie pozostaje natychmiastowe.",
  'movix.button-delay': "Pokaż przycisk Pomiń po",
  'movix.button-delay-hint': "Pozwala odtworzyć początek czołówki lub napisów końcowych, zanim pojawi się Pomiń, żeby przycisk nie zasłaniał końca sceny. Automatyczne pomijanie nie czeka.",
  'movix.button-delay-none': "Od razu",
  'movix.landing': "Zatrzymaj przed końcem",
  'movix.landing-hint': "Pominięcie kończy się tyle przed końcem czołówki lub streszczenia, by nie uciąć pierwszej chwili po nich. Napisy końcowe trwające do końca nadal prowadzą na koniec.",
  'movix.landing-none': "Na końcu",
  'movix.color-intro': "Kolor czołówki",
  'movix.color-recap': "Kolor streszczenia",
  'movix.color-credits': "Kolor napisów końcowych",
  'movix.color-preview': "Kolor zapowiedzi",
  'movix.colors-hint': "Jak każda część wygląda na pasku postępu.",
  'movix.swatch.default': "Standardowy",
  'movix.swatch.amber': "Bursztynowy",
  'movix.swatch.sky': "Błękitny",
  'movix.swatch.mint': "Miętowy",
  'movix.swatch.rose': "Różowy",
  'movix.swatch.violet': "Fioletowy",
  'movix.swatch.white': "Biały",
};
