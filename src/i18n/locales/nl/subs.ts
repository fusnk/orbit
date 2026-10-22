import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Beste match',
  'subs.error.sdh': 'Kan je instelling voor tekst voor doven en slechthorenden niet toepassen',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Tekst voor doven en slechthorenden verwijderen',
  'subs.settings.strip-sdh-hint': 'Verbergt geluidsbeschrijvingen zoals [deur kraakt], muziekaanduidingen en namen van sprekers zoals JAN: in ondertiteling. Regels die leeg worden, worden overgeslagen; de timing blijft gelijk.',
  'subs.settings.keep-lyrics': 'Songteksten behouden',
  'subs.settings.keep-lyrics-hint': 'Gezongen regels met ♪ blijven staan als tekst voor doven en slechthorenden wordt verwijderd. Regels met alleen muzieknoten verdwijnen wel.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Kon ondertiteling niet onderaan houden',
  'subs.player.position': 'Positie van ondertiteling',
  'subs.player.height': 'Hoogte',
  'subs.player.raised': '{value}% hoger',
  'subs.player.reset': 'Terug naar onderen',
  'subs.player.keep-bottom': 'Onderaan houden',
  'subs.player.keep-bottom-hint': 'Eenvoudige ondertiteling (zoals SRT) negeert de plaatsing uit het bestand, zodat elke regel op deze hoogte staat. Eenvoudige ondertiteling in de video verliest ook haar cursief. Opgemaakte ondertiteling (ASS, gebruikelijk bij anime) houdt haar eigen opmaak. Geldt voor elke video.',
};
