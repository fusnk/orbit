import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // One line under each category's title
  'settingshome.intro.general': 'Språk, hur Orbit startar och stängs, komfort, aviseringar och säkerhetskopior.',
  'settingshome.intro.addons': 'Var dina kataloger och strömmar kommer ifrån, och hur Orbit väljer källa.',
  'settingshome.intro.downloads': 'Vad Orbit sparar på den här datorn för att titta offline.',
  'settingshome.intro.shortcuts': 'Varje tangent Orbit lyssnar efter, och vad den gör.',
  'settingshome.intro.home-library': 'Dina rader på Hem, Fortsätt titta och spoilers.',
  'settingshome.intro.subtitles': 'Ditt undertextspråk och hur undertexter ser ut.',
  'settingshome.intro.picture-sound': 'Bilden, hårdvaran som gör jobbet och hur ljudet når dig.',
  'settingshome.intro.accounts': 'Konton och tjänster som Orbit kan arbeta med, och dina egna Live-tv-källor.',
  // Search settings (opens the command palette on Settings)
  'settingshome.search.button': 'Sök i inställningar',
  'settingshome.search.placeholder': 'Sök i inställningar',
  'settingshome.search.none': 'Inga inställningar matchar.',
  // The profile header's service lines
  'settingshome.connections': 'Anslutna tjänster',
  'settingshome.stremio.signed-in': 'Stremio · inloggad',
  'settingshome.stremio.synced': 'Stremio · synkad {when}',
  'settingshome.stremio.synced-now': 'Stremio · synkad nyss',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // The save line
  'settingshome.saved': 'Sparat',
  'settingshome.saved-announce': 'Inställningen har sparats',
  // Settings → General → About Orbit
  'settingshome.about.heading': 'Om Orbit',
  'settingshome.about.version': 'Version {version}',
  'settingshome.about.made-by': 'Skapad av {name}',
  'settingshome.about.licence': 'Fri programvara · {licence}',
  'settingshome.about.source': 'Källkod',
  'settingshome.about.licences': 'Licenser för öppen källkod',
  'settingshome.about.legal-heading': 'Juridisk information',
  'settingshome.about.legal-independent': 'Orbit är en oberoende app med öppen källkod. Den är inte ansluten till, godkänd av eller sponsrad av Stremio, eller av någon tilläggsutvecklare, tjänst eller något företag som nämns i appen. {names} och alla andra namn och logotyper som visas tillhör sina ägare och förekommer bara för att ange vad Orbit fungerar med.',
  'settingshome.about.legal-content': 'Orbit varken lagrar, delar eller indexerar några medier. Allt du spelar upp kommer från tillägg, tjänster eller servrar som du själv har konfigurerat, och du ansvarar för vad du spelar upp och för att följa lagarna där du bor.',
  // Settings → General → About Orbit: updates, and the banner when one is ready
  'settingshome.updates.label': 'Uppdateringar',
  'settingshome.updates.check': 'Sök efter uppdateringar',
  'settingshome.updates.idle': 'Orbit söker en gång om dagen och frågar innan något installeras.',
  'settingshome.updates.idle-manual': 'Orbit söker bara när du ber om det och frågar innan något installeras.',
  'settingshome.updates.idle-auto': 'Orbit söker en gång om dagen och installerar uppdateringen när du avslutar.',
  'settingshome.updates.idle-manual-auto': 'Orbit söker bara när du ber om det och installerar uppdateringen när du avslutar.',
  'settingshome.updates.checking': 'Söker efter uppdateringar…',
  'settingshome.updates.up-to-date': 'Orbit är uppdaterat.',
  'settingshome.updates.downloading': 'Laddar ner Orbit {version}…',
  'settingshome.updates.failed': 'Kunde inte söka efter uppdateringar. Försök igen senare.',
  'settingshome.updates.download-failed': 'Kunde inte ladda ner Orbit {version}. Orbit försöker igen senare.',
  'settingshome.updates.off': 'Uppdateringar är avstängda i den här versionen.',
  'settingshome.updates.ready': 'Orbit {version} är klart',
  'settingshome.updates.restart': 'Starta om för att uppdatera',
  'settingshome.updates.later': 'Senare',
  'settingshome.updates.install-failed': 'Kunde inte installera uppdateringen. Försök igen senare.',
  'settingshome.updates.auto': 'Uppdatera automatiskt',
  'settingshome.updates.auto-hint': 'Installerar en nedladdad uppdatering när du avslutar Orbit. När det är av meddelar Orbit dig bara.',
  'settingshome.updates.check-auto': 'Sök efter uppdateringar automatiskt',
  'settingshome.updates.check-auto-hint': 'Letar efter en ny version en gång om dagen. När det är av söker Orbit bara när du väljer Sök efter uppdateringar.',
  // Shown once after an update
  'settingshome.whats-new.heading': 'Nyheter i Orbit {version}',
  'settingshome.whats-new.plain': 'Orbit har uppdaterats till version {version}.',
  'settingshome.whats-new.close': 'Uppfattat',
};
