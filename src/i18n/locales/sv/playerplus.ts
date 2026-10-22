import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': 'Inställningar',
  'playerplus.hub.back': 'Tillbaka till {to}',
  'playerplus.hub.picture': 'Kvalitet & bild',
  'playerplus.hub.sound': 'Ljud',
  'playerplus.hub.speed-note': 'Håll ned {key} för att spela i 2× så länge du håller den.',
  'playerplus.hub.no-audio': 'Inga ljudspår än. De visas när videon har laddats.',
  'playerplus.hub.timing-sub': 'Undertexter {delay}',
  'playerplus.hub.timing-audio': 'Ljud {delay}',
  'playerplus.hub.timing-none': 'Inte justerad',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': 'Hörde det först',
  'playerplus.timing.heard-first-hint': 'Undertexterna är sena: visa dem tidigare',
  'playerplus.timing.saw-first': 'Såg det först',
  'playerplus.timing.saw-first-hint': 'Undertexterna är tidiga: visa dem senare',
  'playerplus.timing.earlier-by': 'Visa undertexter {value} s tidigare',
  'playerplus.timing.later-by': 'Visa undertexter {value} s senare',

  // Sound
  'playerplus.sound.off': 'Original',
  'playerplus.sound.off-hint': 'Ljudet som det mixades.',
  'playerplus.sound.cinema': 'Bio',
  'playerplus.sound.cinema-hint': 'Fylligare bas och lite mer luft, för film på bra volym.',
  'playerplus.sound.music': 'Musik',
  'playerplus.sound.music-hint': 'Varmare bas och klarare diskant, för konserter och musikaler.',
  'playerplus.sound.dialogue': 'Tydlig dialog',
  'playerplus.sound.dialogue-hint': 'Röster lyfts fram över musik och effekter.',
  'playerplus.sound.note': 'En i taget. Sparas för alla videor.',

  // Live source search
  'playerplus.search.label': 'Söker en källa för {name}',
  'playerplus.search.finding': 'Söker tillägg…',
  'playerplus.search.asking': 'Frågar…',
  'playerplus.search.sources.one': '{count} källa',
  'playerplus.search.sources.other': '{count} källor',
  'playerplus.search.none': 'Inga resultat',
  'playerplus.search.failed': 'Svarade inte',
  'playerplus.search.progress.one': '{count} av {total} tillägg har svarat · {found} källor hittills',
  'playerplus.search.progress.other': '{count} av {total} tillägg har svarat · {found} källor hittills',

  // Time readout
  'playerplus.time.finish': '{left} kvar · Slutar {time}',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'Intro',
  'playerplus.bands.recap': 'Resumé',
  'playerplus.bands.credits': 'Eftertexter',
  'playerplus.bands.preview': 'Förhandstitt',

  // Skipping
  'playerplus.skip.preview': 'Hoppa över förhandstitt',
  'playerplus.skip.skipped-credits': 'Hoppade över eftertexterna',
  'playerplus.skip.skipped-preview': 'Hoppade över förhandstitten',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds} s',
  'playerplus.bubble.back': '−{seconds} s',

  // Shortcut list
  'playerplus.cheat.action': 'Visa spelarens kortkommandon',
  'playerplus.cheat.title': 'Spelarens kortkommandon',
  'playerplus.cheat.playback': 'Uppspelning',
  'playerplus.cheat.sound': 'Ljud & undertexter',
  'playerplus.cheat.window': 'Bild & fönster',
  'playerplus.cheat.fixed': 'Alltid',
  'playerplus.cheat.no-key': 'Ingen tangent',
  'playerplus.cheat.hold': 'Håll ned {key}',
  'playerplus.keys.number-jump': 'Hoppa till 0–90 % av videon',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'Spela i 2× medan du håller ned',
  'playerplus.keys.hold-boost-keys': 'Håll ned {key}',

  // Lock
  'playerplus.lock.action': 'Lås kontroller',
  'playerplus.lock.unlock': 'Lås upp',
  'playerplus.lock.hint': 'Kontrollerna är låsta. Tryck på Esc tre gånger för att låsa upp.',
  'playerplus.lock.hint-key': 'Kontrollerna är låsta. Tryck på {key}, eller Esc tre gånger, för att låsa upp.',
  'playerplus.lock.unlocked': 'Kontrollerna upplåsta',

  // Docked episodes
  'playerplus.dock.collapse': 'Dölj avsnitt',
  'playerplus.dock.expand': 'Visa avsnitt',
  'playerplus.dock.number': 'A{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': 'Håll ned för 2× hastighet',
  'playerplus.settings.hold-boost-hint': 'Håller du ned spela/pausa-tangenten spelas videon i dubbel hastighet tills du släpper. Ett tryck pausar fortfarande.',
  'playerplus.settings.number-jump': 'Siffertangenter hoppar',
  'playerplus.settings.number-jump-hint': '1 hoppar till 10 % av videon, 5 till halvvägs, 0 till början. Tangenter som du har gett ett annat kortkommando behåller det.',
  'playerplus.settings.grayscale': 'Svartvitt vid paus',
  'playerplus.settings.grayscale-hint': 'Den pausade bilden tonas till grått; färgen kommer tillbaka när den spelas.',
  'playerplus.settings.episodes': 'Avsnittslista',
  'playerplus.settings.episodes-hint': 'Flytande öppnas över kontrollerna. Dockad behåller en lista till höger som fälls ihop till en liten flik.',
  'playerplus.settings.episodes-floating': 'Flytande',
  'playerplus.settings.episodes-docked': 'Dockad',
  'playerplus.settings.skipping': 'Hoppa över',
  'playerplus.settings.skipping-hint': 'Knapp visar Hoppa över medan det spelas; Automatiskt hoppar över utan att fråga (en gång: spola tillbaka in i det för att se det).',
  'playerplus.settings.skip-intro': 'Intron',
  'playerplus.settings.skip-recap': 'Resuméer',
  'playerplus.settings.skip-credits': 'Eftertexter',
  'playerplus.settings.skip-preview': 'Förhandstittar efter eftertexterna',
  'playerplus.settings.skip-off': 'Av',
  'playerplus.settings.skip-button': 'Knapp',
  'playerplus.settings.skip-auto': 'Automatiskt',
  'playerplus.settings.learn-skips': 'Lär dig var jag hoppar över intron',
  'playerplus.settings.learn-skips-hint': 'Hoppa över ett intro manuellt i en serie så erbjuder senare avsnitt Hoppa över intro vid samma tid, när inga andra hopptider är kända. Sparas på den här enheten, för den här profilen.',
  'playerplus.settings.forget-skips': 'Inlärda introtider',
  'playerplus.settings.forget-skips-hint': 'Glömmer introtiderna som lärts in för alla serier i den här profilen.',
  'playerplus.settings.forget-skips-action': 'Glöm',
  'playerplus.settings.forget-skips-done': 'Inlärda introtider glömda',
};
