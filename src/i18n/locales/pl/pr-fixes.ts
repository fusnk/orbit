import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Polish strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Zaktualizować ustawienia tego dodatku?",
  'prfixes.addons.update-detail': "{name} jest już zainstalowany. Te ustawienia zastąpią poprzednie, a dodatek zachowa swoje miejsce na liście.",
  'prfixes.addons.update': "Zaktualizuj",
  'prfixes.audio.original': "Najpierw język oryginalny",
  'prfixes.audio.original-hint': "Każdy film lub serial startuje w języku, w którym powstał, jeśli wideo ma taką ścieżkę audio: anime po japońsku, koreańska drama po koreańsku. W przeciwnym razie język audio powyżej. Wymaga klucza TMDB.",
  'prfixes.bundle.local': "Ten adres prowadzi do tego komputera lub Twojej sieci domowej, więc Orbit się z nim nie połączył.",
};
