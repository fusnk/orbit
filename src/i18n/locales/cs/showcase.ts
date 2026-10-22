import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Nastavení → Vzhled → Stránka titulu.
  'showcase.setting.label': 'Stránka titulu',
  'showcase.setting.hint': 'Klasická drží obrázek v kartě. Showcase ho roztáhne přes celé okno a podrobnosti dá do sekcí pod něj.',
  'showcase.setting.classic': 'Klasická',
  'showcase.setting.showcase': 'Showcase',
  // Úvodní část.
  'showcase.start-episode': 'Spustit S{season} · E{episode}',
  'showcase.ends-at': 'Skončí v {time}',
  'showcase.ends-at-hint': 'Kdy by to skončilo, kdybyste začali teď',
  'showcase.age-rating': 'Přístupnost {rating}',
  'showcase.streaming-on': 'Streamuje se na {provider}',
  // Díly.
  'showcase.choose-season': 'Řada',
  'showcase.choose-arc': 'Dějový oblouk',
  'showcase.episode-count.one': '{count} díl',
  'showcase.episode-count.few': '{count} díly',
  'showcase.episode-count.other': '{count} dílů',
  'showcase.episode-length': '{number} · {minutes} min',
  'showcase.season-actions': 'Akce s řadou',
  'showcase.download-season.one': 'Stáhnout řadu ({count} díl)',
  'showcase.download-season.few': 'Stáhnout řadu ({count} díly)',
  'showcase.download-season.other': 'Stáhnout řadu ({count} dílů)',
  // Sekce.
  'showcase.extras': 'Trailery a bonusy',
  'showcase.cast-crew': 'Herci a tvůrci',
  'showcase.photos': 'Fotografie',
  'showcase.stills': 'Záběry',
  'showcase.topics': 'Témata',
  'showcase.topic-intro': 'Filmy a seriály, které TMDB označuje tématem „{topic}“.',
  'showcase.where-to-watch': 'Kde sledovat',
  'showcase.stream': 'Stream',
  'showcase.rent': 'Půjčit',
  'showcase.buy': 'Koupit',
  'showcase.justwatch': 'Data od JustWatch',
  'showcase.releases': 'Data uvedení',
  'showcase.cinemas-only': 'Zatím jen v kinech — rané kopie bývají obvykle nahrávky z kina.',
};
