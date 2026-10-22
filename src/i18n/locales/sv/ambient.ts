import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': 'Bakgrundsläge',
  'ambient.hint.details': 'Enter för detaljer',
  'ambient.slide.resume': 'Återuppta',
  'ambient.slide.resume-episode': 'Återuppta {episode}',
  'ambient.slide.library': 'I Mitt bibliotek',
  'ambient.slide.recent': 'Nyligen sedda',
  'ambient.slide.trending': 'Populärt nu',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': 'Bakgrundsläge',
  'ambient.settings.after': 'Starta efter',
  'ambient.settings.after-hint': 'Om inget trycks på så här länge tonar Orbit över till ett långsamt bildspel med omslagsbilder. Aldrig medan något spelas.',
  'ambient.settings.source': 'Vad som visas',
  'ambient.settings.source-hint': 'Det du tittar på och har sparat, det som är populärt, eller båda växelvis.',
  'ambient.settings.source-for-you': 'För dig',
  'ambient.settings.source-trending': 'Trendar',
  'ambient.settings.source-both': 'Båda',
  'ambient.settings.clock': 'Visa klockan',
  'ambient.settings.clock-hint': 'Tid och datum i ett hörn.',
  'ambient.settings.paused': 'Även vid paus',
  'ambient.settings.paused-hint': 'Startar över spelaren när den har varit pausad så här länge. Uppspelningen förblir exakt som den var.',
  'ambient.settings.preview': 'Förhandsvisning',
  'ambient.settings.preview-label': 'Se det nu',
  'ambient.settings.preview-hint': 'Startar bakgrundsläget direkt. Tryck på valfri tangent eller rör musen för att komma tillbaka.',
};
