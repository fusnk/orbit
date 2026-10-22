import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Nastavení → Integrace → Jellyfin
  'jellyfin.settings.intro': 'Přehrávejte ze svého vlastního serveru Jellyfin. Filmy a díly, které na něm jsou, dostanou zdroj Jellyfin a jeho řádky mohou být na stránce Domů. Orbit si uchovává přihlašovací token ze serveru, nikdy vaše heslo.',
  'jellyfin.settings.server': 'Adresa serveru',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Uživatelské jméno',
  'jellyfin.settings.password': 'Heslo',
  'jellyfin.settings.fields-hint': 'Adresa, na které Jellyfin otevíráte v prohlížeči. Vyžaduje Jellyfin 10.9 nebo novější.',
  'jellyfin.settings.connect': 'Připojit',
  'jellyfin.settings.connecting': 'Připojování…',
  'jellyfin.settings.server-label': 'Server',
  'jellyfin.settings.connected-as': 'Připojeno jako {user} k {server}',
  'jellyfin.settings.connected': 'Připojeno k {server}.',
  'jellyfin.settings.connected-first': 'Připojeno k {server}. Řádek „Nedávno přidané“ je teď na stránce Domů; další řádky Jellyfin přidáte v Nastavení → Domů a knihovna → Řádky na stránce Domů.',
  'jellyfin.settings.disconnect': 'Odpojit',
  'jellyfin.settings.disconnected': 'Odpojeno a odhlášeno ze serveru.',
  'jellyfin.settings.insecure': 'Nezabezpečeno',
  'jellyfin.settings.insecure-title': 'Tento server používá prosté http, takže přihlášení i videa putují nešifrovaně. Doma to nevadí; přes internet používejte https.',
  // Řádky na stránce Domů
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Pokračovat ve sledování',
  'jellyfin.rows.latest': 'Nedávno přidané',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Nejdřív připojte server Jellyfin v Nastavení → Účty a služby.',
  'jellyfin.rows.libraries-failed': 'Knihovny serveru se nepodařilo načíst.',
  // Výběr zdroje
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
