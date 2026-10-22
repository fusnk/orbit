import type { settingshome as source } from '../en/settingshome';
import type { Catalog } from '../types';

export const settingshome: Catalog<typeof source> = {
  // Jeden řádek pod názvem každé kategorie
  'settingshome.intro.general': 'Jazyk, jak se Orbit spouští a zavírá, pohodlí, upozornění a zálohy.',
  'settingshome.intro.addons': 'Odkud pocházejí vaše katalogy a streamy a jak Orbit vybírá zdroj.',
  'settingshome.intro.downloads': 'Co Orbit uchovává na tomto počítači pro sledování offline.',
  'settingshome.intro.shortcuts': 'Všechny klávesy, na které Orbit reaguje, a co dělají.',
  'settingshome.intro.home-library': 'Vaše řádky na stránce Domů, Pokračovat ve sledování a spoilery.',
  'settingshome.intro.subtitles': 'Jazyk titulků a jak titulky vypadají.',
  'settingshome.intro.picture-sound': 'Obraz, hardware, který odvádí práci, a jak k vám dorazí zvuk.',
  'settingshome.intro.accounts': 'Účty a služby, se kterými Orbit umí pracovat, a vaše vlastní zdroje živého vysílání.',
  // Hledání v nastavení (otevře paletu příkazů v Nastavení)
  'settingshome.search.button': 'Hledat v nastavení',
  'settingshome.search.placeholder': 'Hledat v nastavení',
  'settingshome.search.none': 'Žádné nastavení neodpovídá.',
  // Řádky služeb v záhlaví profilu
  'settingshome.connections': 'Připojené služby',
  'settingshome.stremio.signed-in': 'Stremio · přihlášeno',
  'settingshome.stremio.synced': 'Stremio · synchronizováno {when}',
  'settingshome.stremio.synced-now': 'Stremio · synchronizováno právě teď',
  'settingshome.jellyfin': 'Jellyfin · {server}',
  'settingshome.plex': 'Plex · {server}',
  'settingshome.letterboxd': 'Letterboxd · {name}',
  // Řádek uložení
  'settingshome.saved': 'Uloženo',
  'settingshome.saved-announce': 'Nastavení uloženo',
  // Nastavení → Obecné → O Orbitu
  'settingshome.about.heading': 'O Orbitu',
  'settingshome.about.version': 'Verze {version}',
  'settingshome.about.made-by': 'Vytvořil {name}',
  'settingshome.about.licence': 'Svobodný software · {licence}',
  'settingshome.about.source': 'Zdrojový kód',
  'settingshome.about.licences': 'Licence open-source',
  'settingshome.about.legal-heading': 'Právní informace',
  'settingshome.about.legal-independent': 'Orbit je nezávislá aplikace s otevřeným zdrojovým kódem. Není spojená se Stremio ani s žádným autorem doplňků, službou či společností uvedenou v aplikaci, ani jimi podporovaná či sponzorovaná. {names} a všechny další zobrazené názvy a loga patří svým vlastníkům a uvádějí se jen proto, aby bylo jasné, s čím Orbit funguje.',
  'settingshome.about.legal-content': 'Orbit nehostuje, nesdílí ani neindexuje žádná média. Vše, co přehráváte, pochází z doplňků, služeb nebo serverů, které si sami nastavíte, a za to, co přehráváte, i za dodržování zákonů v místě, kde žijete, odpovídáte vy.',
  // Nastavení → Obecné → O Orbitu: aktualizace a banner, když je nějaká připravená
  'settingshome.updates.label': 'Aktualizace',
  'settingshome.updates.check': 'Zkontrolovat aktualizace',
  'settingshome.updates.idle': 'Orbit kontroluje jednou denně a před instalací se zeptá.',
  'settingshome.updates.idle-manual': 'Orbit kontroluje jen na požádání a před instalací se zeptá.',
  'settingshome.updates.idle-auto': 'Orbit kontroluje jednou denně a aktualizaci nainstaluje, když ho ukončíte.',
  'settingshome.updates.idle-manual-auto': 'Orbit kontroluje jen na požádání a aktualizaci nainstaluje, když ho ukončíte.',
  'settingshome.updates.checking': 'Kontrola aktualizací…',
  'settingshome.updates.up-to-date': 'Orbit je aktuální.',
  'settingshome.updates.downloading': 'Stahování Orbitu {version}…',
  'settingshome.updates.failed': 'Aktualizace se nepodařilo zkontrolovat. Zkuste to později.',
  'settingshome.updates.download-failed': 'Orbit {version} se nepodařilo stáhnout. Orbit to zkusí znovu později.',
  'settingshome.updates.off': 'Aktualizace jsou v tomto sestavení vypnuté.',
  'settingshome.updates.ready': 'Orbit {version} je připravený',
  'settingshome.updates.restart': 'Restartovat a aktualizovat',
  'settingshome.updates.later': 'Později',
  'settingshome.updates.install-failed': 'Aktualizaci se nepodařilo nainstalovat. Zkuste to později.',
  'settingshome.updates.auto': 'Aktualizovat automaticky',
  'settingshome.updates.auto-hint': 'Nainstaluje staženou aktualizaci, když Orbit ukončíte. Když je vypnuto, Orbit vám jen dá vědět.',
  'settingshome.updates.check-auto': 'Automaticky kontrolovat aktualizace',
  'settingshome.updates.check-auto-hint': 'Jednou denně hledá novou verzi. Když je vypnuto, Orbit kontroluje jen po volbě „Zkontrolovat aktualizace“.',
  // Zobrazí se jednou po aktualizaci
  'settingshome.whats-new.heading': 'Novinky v Orbitu {version}',
  'settingshome.whats-new.plain': 'Orbit byl aktualizován na verzi {version}.',
  'settingshome.whats-new.close': 'Rozumím',
};
