import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // Sekce „Omezení obsahu“ v editoru profilu
  'parental.heading': 'Omezení obsahu',
  'parental.level.off': 'Vypnuto',
  'parental.level.kids': 'Děti',
  'parental.level.older-kids': 'Starší děti',
  'parental.level.teens': 'Teenageři',
  'parental.level.no-adult': 'Vše kromě obsahu pro dospělé',
  'parental.about.off': 'Vše, co nabízejí vaše doplňky.',
  'parental.about.kids': 'Jen tituly přístupné pro všechny věkové kategorie: G, TV-Y, TV-Y7 a TV-G, nebo obdoba ve vaší zemi (U ve Spojeném království, FSK 0 a 6 v Německu).',
  'parental.about.older-kids': 'Navíc PG a TV-PG (PG ve Spojeném království, jinde zhruba do 11 let).',
  'parental.about.teens': 'Navíc PG-13 a TV-14 (12 a 12A ve Spojeném království, FSK 12 v Německu).',
  'parental.about.no-adult': 'Navíc R a TV-MA. Skryté jsou jen tituly výhradně pro dospělé (NC-17, X, R18).',
  'parental.addons-note': 'Doplňky označené jako obsah pro dospělé jsou skryté v každém profilu s omezením.',
  'parental.unrated': 'Zobrazovat tituly bez hodnocení',
  'parental.unrated-hidden': 'Tituly, ke kterým Orbit nenajde hodnocení, jsou skryté. To zahrnuje většinu titulů z doplňků, které nepoužívají IMDb ID.',
  'parental.unrated-shown': 'Tituly, ke kterým Orbit nenajde hodnocení, se zobrazují.',
  'parental.live-tv': 'Zobrazovat živé vysílání',
  'parental.live-tv-hint': 'Televizní kanály nemají hodnocení, takže je omezení nemůže filtrovat.',
  'parental.region': 'Hodnocení se čte nejdřív pro zemi {country}, pak pro USA.',
  'parental.needs-tmdb': 'Hodnocení pochází z TMDB, které není připojené (Nastavení → Účty a služby). Dokud nebude, každý titul se počítá jako bez hodnocení a tento profil nezobrazí žádný titul bez hodnocení, ať je přepínač výše jakkoli. Nezobrazí tedy skoro nic.',
  'parental.no-parent': 'Žádný profil bez omezení nemá PIN, takže toto omezení může změnit kdokoli. Nastavte PIN svému vlastnímu profilu.',
  'parental.open-profiles': 'Kdokoli v tomto profilu se pořád může přepnout na {names}: bez PINu a bez omezení.',
  'parental.who-changes': 'Uvolnění nebo zrušení omezení vyžaduje PIN profilu bez omezení.',
  'parental.badge': 'Omezení obsahu: {level}',
  // Žádost o PIN rodiče
  'parental.parent-pin': 'PIN rodiče',
  'parental.parent-pin-prompt': 'Zadejte PIN profilu bez omezení obsahu.',
  'parental.parent-pin-create': 'Dokud má některý profil omezení obsahu, přidání profilu vyžaduje PIN profilu bez omezení.',
  // Kde omezení něco zastaví
  'parental.blocked.title': 'V tomto profilu není k dispozici',
  'parental.blocked.rated': '{name} má hodnocení {rating}, nad omezením tohoto profilu ({level}).',
  'parental.blocked.adult': '{name} je označeno jako obsah pro dospělé.',
  'parental.blocked.unrated': 'Orbit nenašel hodnocení pro {name} a tento profil skrývá tituly bez hodnocení.',
  'parental.blocked.toast': '{name} není v tomto profilu k dispozici.',
  'parental.blocked.checking': 'Orbit ještě ověřuje hodnocení pro {name}. Stránka se otevře sama, jakmile bude známé.',
  'parental.blocked.checking-toast': 'Orbit ještě ověřuje hodnocení pro {name}. Zkuste to za chvíli znovu.',
  'parental.blocked.unreachable': 'Orbit teď nemohl ověřit hodnocení pro {name}. Zkuste to za chvíli znovu.',
  'parental.blocked.live': 'Živé vysílání je v tomto profilu vypnuté.',
};
