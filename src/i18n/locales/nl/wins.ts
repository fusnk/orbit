import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** Dutch strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Vanaf',
  'explore.filters.year-to': 'Tot',
  'explore.filters.runtime': 'Speelduur',
  'explore.filters.runtime-min': 'Minstens',
  'explore.filters.runtime-max': 'Hoogstens',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Cast',
  'explore.filters.director': 'Regie of crew',
  'explore.filters.person-search': 'Personen zoeken: {what}',
  'explore.filters.person-placeholder': 'Typ een naam',
  'explore.filters.person-none': 'Niemand gevonden',
  'explore.filters.person-clear': '{name} verwijderen',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Terugspoelbuffer',
  'settings.player.rewind-hint': 'Hoeveel van de video in het geheugen blijft, zodat terugspringen meteen gaat. Meer gebruikt tijdens het afspelen tot ongeveer 600 MB RAM, Meest tot ongeveer 1,5 GB. Geldt vanaf de volgende video.',
  'settings.player.rewind-standard': 'Standaard',
  'settings.player.rewind-more': 'Meer',
  'settings.player.rewind-most': 'Meest',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Dekking van tekst',
  'subs.style.box-colour': 'Kleur van het vak',
  'subs.style.box-opacity': 'Dekking van het vak',
  'subs.style.box-opacity-hint': 'Het vak heeft rechte hoeken: de speler kan geen afgeronde tekenen.',
  'subs.style.outline-colour': 'Kleur van de omlijning',
  'player.subtitle-style.black': 'Zwart',
  'player.subtitle-style.grey': 'Grijs',
  'player.subtitle-style.navy': 'Marineblauw',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Gaf geen antwoord',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} geïnstalleerd',
  'addons.health.installed.other': '{count} geïnstalleerd',
  'addons.health.enabled.one': '{count} ingeschakeld',
  'addons.health.enabled.other': '{count} ingeschakeld',
  'addons.health.refresh': 'Add-on vernieuwen',
  'addons.health.refreshing': '{name} vernieuwen…',
  'addons.health.refreshed': '{name} is bijgewerkt.',
  'addons.health.unchanged': '{name} gaf antwoord: niets veranderd.',
  'addons.health.refresh-failed': '{name} antwoordde niet. Orbit blijft gebruiken wat het had.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Minimale grootte',
  'sources.rules.min-size-hint': 'Voor films; afleveringen krijgen een derde. Kleinere bestanden, vaak nep of in de bioscoop opgenomen, komen na alle andere, maar worden nooit verborgen. Bronnen zonder opgegeven grootte vallen erbuiten.',
  'titles.why.under-size': 'Onder je minimum van {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Collectie zoeken',
  'collections.search.placeholder': 'Collectie zoeken',
  'collections.search.none': 'Geen collectie komt overeen',
  'collections.search.none-detail': 'Er wordt gezocht in namen en groepen.',
  'collections.search.titles-label': 'Titel in deze collectie zoeken',
  'collections.search.titles-placeholder': 'Titel zoeken',
  'collections.search.no-titles': 'Geen titel komt overeen',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Exporteren naar agenda (.ics)',
  'radar.export.hint': 'Bewaart wat de Radar toont als bestand dat elke agenda-app kan importeren.',
  'radar.export.name': 'Orbit Releaseradar',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} over {seconds}',
  'playerplus.settings.skip-delay': 'Wachten voor automatisch overslaan',
  'playerplus.settings.skip-delay-hint': 'Voor delen op Automatisch: de knop Overslaan telt eerst af. Druk op een willekeurige toets om te stoppen en te kijken.',
  'playerplus.settings.skip-delay-none': 'Meteen',
};
