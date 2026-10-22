import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Nastavení → Přehrávání → Limity automatického přehrávání (pro profil)
  'sources.limits.heading': 'Limity automatického přehrávání',
  'sources.limits.any': 'Libovolná',
  'sources.limits.min-quality': 'Automaticky nespouštět pod',
  'sources.limits.min-quality-hint': 'Přehrát a další díl spustí jen zdroje aspoň takto dobré (zdroje, které kvalitu neuvádějí, ne). Pokud žádný nevyhovuje, přehraje se nejlepší a Orbit vám dá vědět. Seznam zdrojů dál ukazuje vše. Pro tento profil.',
  'sources.limits.max-quality': 'Automaticky nespouštět nad',
  'sources.limits.max-quality-hint': 'Přehrát a další díl nespustí zdroje nad touto kvalitou, pokud se nenajde nic jiného. Na rozdíl od „Nejvyšší preferovaná kvalita“ nemění pořadí seznamu zdrojů. Pro tento profil.',
  'sources.limits.max-size': 'Automaticky nespouštět soubory větší než',
  'sources.limits.max-size-hint': 'Pro pomalá připojení nebo datové limity: Přehrát a další díl větší soubory přeskočí. Zdrojů, které velikost neuvádějí, se to netýká. Pro tento profil.',
  // Oznámení, když se zdroj vybere automaticky
  'sources.autoplay.outside-limits': 'Vašim limitům automatického přehrávání nic nevyhovuje, takže se přehrává nejlepší zdroj.',
  'sources.autoplay.only-uncached': 'Všechny nalezené zdroje se ještě stahují do vaší služby Debrid. Vyberte jeden a spusťte ho.',
  // Nenápadné štítky v seznamu zdrojů
  'sources.note.uncached': 'Není v mezipaměti',
  'sources.note.uncached-hint': 'Ještě se stahuje do vaší služby Debrid: nikdy se nespustí automaticky',
  'sources.note.outside-limits': 'Mimo limity automatického přehrávání',
  'sources.note.outside-limits-hint': 'Přehrát a další díl ho přeskočí (Nastavení → Doplňky a zdroje → Předvolby zdrojů → Limity automatického přehrávání)',
  // Karta Další na řadě pro díl, jehož datum vysílání není potvrzené
  'sources.next-up.unaired': 'Další na řadě · datum vysílání nepotvrzeno',
};
