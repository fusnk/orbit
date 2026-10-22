import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': 'Spela upp från din egen Jellyfin-server. Filmer och avsnitt som finns där får en Jellyfin-källa, och dess rader kan visas på Hem. Orbit sparar en inloggningstoken från servern, aldrig ditt lösenord.',
  'jellyfin.settings.server': 'Serveradress',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Användarnamn',
  'jellyfin.settings.password': 'Lösenord',
  'jellyfin.settings.fields-hint': 'Adressen du öppnar Jellyfin på i en webbläsare. Kräver Jellyfin 10.9 eller senare.',
  'jellyfin.settings.connect': 'Anslut',
  'jellyfin.settings.connecting': 'Ansluter…',
  'jellyfin.settings.server-label': 'Server',
  'jellyfin.settings.connected-as': 'Ansluten som {user} på {server}',
  'jellyfin.settings.connected': 'Ansluten till {server}.',
  'jellyfin.settings.connected-first': 'Ansluten till {server}. ”Nyligen tillagt” finns nu på Hem; lägg till fler Jellyfin-rader i Inställningar → Hem & bibliotek → Rader på Hem.',
  'jellyfin.settings.disconnect': 'Koppla från',
  'jellyfin.settings.disconnected': 'Frånkopplad och utloggad från servern.',
  'jellyfin.settings.insecure': 'Inte säker',
  'jellyfin.settings.insecure-title': 'Den här servern använder vanlig http, så din inloggning och dina videor skickas okrypterade. Okej hemma; använd https över internet.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Fortsätt titta',
  'jellyfin.rows.latest': 'Nyligen tillagt',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Anslut en Jellyfin-server i Inställningar → Konton & tjänster först.',
  'jellyfin.rows.libraries-failed': 'Kunde inte ladda serverns bibliotek.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
