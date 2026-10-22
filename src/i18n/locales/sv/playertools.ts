import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'Anpassad',
  'playertools.speed.custom-label': 'Anpassad hastighet',
  'playertools.speed.slower': 'Långsammare (−0.05×)',
  'playertools.speed.faster': 'Snabbare (+0.05×)',
  'playertools.subs.try-another': 'Prova en annan undertext',
  'playertools.subs.try-another-detail': 'Näst bästa matchning på {language}',
  'playertools.subs.cycled': 'Undertext {position} av {total} · {source}',
  'playertools.subs.no-other': 'Inga andra undertexter att prova',
  'playertools.paste.action': 'Klistra in undertexter…',
  'playertools.paste.detail': 'SRT- eller WebVTT-text',
  'playertools.paste.title': 'Klistra in undertexter',
  'playertools.paste.hint': 'Klistra in texten från en SRT- eller WebVTT-fil. Den läggs bara till för den här videon.',
  'playertools.paste.field': 'Undertexttext',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nHej!',
  'playertools.paste.add': 'Lägg till undertexter',
  'playertools.paste.cancel': 'Avbryt',
  'playertools.paste.empty': 'Klistra in lite undertexttext först.',
  'playertools.paste.too-big': 'Det är mer än 2 MB text.',
  'playertools.paste.bad': 'Det ser inte ut som SRT- eller WebVTT-undertexter.',
  'playertools.paste.added': 'Inklistrade undertexter tillagda',
  'playertools.paste.name': 'Inklistrade undertexter',
  'playertools.caps.setting': 'Fixa undertexter i VERSALER',
  'playertools.caps.hint': 'Rader skrivna helt i versaler får vanlig meningsskrivning. Fungerar på undertexter från tillägg, filer du lägger till och inklistrad text, inte på undertexter inuti videofilen. Namn förlorar också sina versaler.',
  'playertools.caps.error': 'Kunde inte tillämpa inställningen för VERSALER',
};
