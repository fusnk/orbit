import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Czech strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Aktualizovat nastavení tohoto doplňku?",
  'prfixes.addons.update-detail': "{name} už je nainstalovaný. Tato nastavení nahradí ta stará a doplněk si ponechá své místo v seznamu.",
  'prfixes.addons.update': "Aktualizovat",
  'prfixes.audio.original': "Nejdřív původní jazyk",
  'prfixes.audio.original-hint': "Každý film nebo seriál začne v jazyce, ve kterém vznikl, pokud video tuto zvukovou stopu má: anime v japonštině, korejské drama v korejštině. Jinak jazyk zvuku výše. Vyžaduje klíč TMDB.",
  'prfixes.bundle.local': "Tato adresa vede na tento počítač nebo do vaší domácí sítě, proto ji Orbit nekontaktoval.",
};
