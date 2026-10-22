import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Loslaten om af te spelen',
  'local.drop.video-hint': 'De video speelt af in Orbit.',
  'local.drop.subtitle-hint': 'De ondertitels worden toegevoegd aan wat er speelt.',
  'local.drop.first-only': '{name} wordt afgespeeld. Orbit speelt één bestand tegelijk af, dus de rest is overgeslagen.',
  'local.drop.failed': 'Dat bestand kon niet worden geopend.',
  'local.drop.unsupported': 'Orbit kan dat soort bestand niet afspelen.',
  'local.drop.subtitle-needs-player': 'Start eerst een video en laat de ondertitels er daarna op los.',
  'local.drop.subtitle-added': 'Ondertitels toegevoegd: {name}',
  'local.drop.subtitle-first-only': 'Ondertitels toegevoegd: {name}. Alleen het eerste bestand is gebruikt.',
  'local.drop.subtitle-failed': 'Die ondertitels konden niet worden toegevoegd.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'deze pc',
  'local.source.label': 'Lokaal bestand',
  // Settings → Player → External player
  'local.external.heading': 'Externe speler',
  'local.external.player': 'Bronnen openen in',
  'local.external.player-hint': 'Voegt ‘Openen in externe speler’ toe aan webbronnen in de bronkiezer. Hervatten, intro overslaan, onthouden sporen en voortgang werken alleen in de eigen speler van Orbit.',
  'local.external.none': 'Geen',
  'local.external.custom': 'Aangepast',
  'local.external.found': 'Gevonden: {path}',
  'local.external.not-found': 'Niet gevonden in de gebruikelijke installatiemap. Kies Aangepast om de locatie op te geven.',
  'local.external.custom-path': 'Programma',
  'local.external.custom-path-hint': 'Het programmabestand van de speler, gekozen op deze pc.',
  'local.external.choose': 'Kiezen…',
  'local.external.custom-invalid': 'Orbit kan dat niet starten. Kies het programmabestand van de speler.',
  'local.external.always': 'Altijd openen in de externe speler',
  'local.external.always-hint': 'Afspelen geeft de beste webbron direct door. Torrents en downloads spelen nog steeds in Orbit.',
  // The source picker
  'local.external.open': 'Extern',
  'local.external.open-label': 'Openen in externe speler',
  'local.external.opened': 'Geopend in de externe speler.',
  'local.external.failed': 'De externe speler is niet gestart. Kijk bij Instellingen → Speler.',
};
