import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // The profile editor's "Content limit" section
  'parental.heading': 'Innehållsgräns',
  'parental.level.off': 'Av',
  'parental.level.kids': 'Barn',
  'parental.level.older-kids': 'Äldre barn',
  'parental.level.teens': 'Tonåringar',
  'parental.level.no-adult': 'Allt utom vuxet',
  'parental.about.off': 'Allt som dina tillägg erbjuder.',
  'parental.about.kids': 'Bara titlar som är tillåtna för alla åldrar: G, TV-Y, TV-Y7 och TV-G, eller motsvarande i ditt land (U i Storbritannien, FSK 0 och 6 i Tyskland).',
  'parental.about.older-kids': 'Även PG och TV-PG (PG i Storbritannien, upp till ungefär 11 år på andra håll).',
  'parental.about.teens': 'Även PG-13 och TV-14 (12 och 12A i Storbritannien, FSK 12 i Tyskland).',
  'parental.about.no-adult': 'Även R och TV-MA. Bara gränser enbart för vuxna (NC-17, X, R18) döljs.',
  'parental.addons-note': 'Tillägg som är märkta som vuxeninnehåll döljs på alla profiler med en gräns.',
  'parental.unrated': 'Visa titlar utan åldersgräns',
  'parental.unrated-hidden': 'Titlar utan en åldersgräns som Orbit kan hitta döljs. Det gäller de flesta titlar från tillägg som inte använder IMDb-id:n.',
  'parental.unrated-shown': 'Titlar utan en åldersgräns som Orbit kan hitta visas.',
  'parental.live-tv': 'Visa Live-tv',
  'parental.live-tv-hint': 'Tv-kanaler har inga åldersgränser, så gränsen kan inte filtrera dem.',
  'parental.region': 'Åldersgränser läses först för {country}, sedan för USA.',
  'parental.needs-tmdb': 'Åldersgränser kommer från TMDB, som inte är anslutet (Inställningar → Konton & tjänster). Tills det är det räknas alla titlar som saknande åldersgräns, och den här profilen visar inga titlar utan åldersgräns, oavsett reglaget ovan. Så den visar nästan ingenting.',
  'parental.no-parent': 'Ingen profil utan gräns har en PIN-kod, så vem som helst kan ändra den här gränsen. Ge din egen profil en PIN-kod.',
  'parental.open-profiles': 'Alla på den här profilen kan fortfarande byta till {names}: ingen PIN-kod och ingen gräns.',
  'parental.who-changes': 'För att lätta på eller ta bort en gräns krävs PIN-koden för en profil utan gräns.',
  'parental.badge': 'Innehållsgräns: {level}',
  // Asking for a parent's PIN
  'parental.parent-pin': 'Förälderns PIN-kod',
  'parental.parent-pin-prompt': 'Ange PIN-koden för en profil utan innehållsgräns.',
  'parental.parent-pin-create': 'När en profil har en innehållsgräns krävs PIN-koden för en profil utan gräns för att lägga till en profil.',
  // Where a limit stops something
  'parental.blocked.title': 'Inte tillgängligt på den här profilen',
  'parental.blocked.rated': '{name} har åldersgränsen {rating}, över den här profilens gräns ({level}).',
  'parental.blocked.adult': '{name} är märkt som vuxeninnehåll.',
  'parental.blocked.unrated': 'Orbit kunde inte hitta någon åldersgräns för {name}, och den här profilen döljer titlar utan åldersgräns.',
  'parental.blocked.toast': '{name} är inte tillgängligt på den här profilen.',
  'parental.blocked.checking': 'Orbit kontrollerar fortfarande åldersgränsen för {name}. Sidan öppnas av sig själv när den är känd.',
  'parental.blocked.checking-toast': 'Orbit kontrollerar fortfarande åldersgränsen för {name}. Försök igen om en stund.',
  'parental.blocked.unreachable': 'Orbit kunde inte kontrollera åldersgränsen för {name} just nu. Försök igen om en stund.',
  'parental.blocked.live': 'Live-tv är avstängt för den här profilen.',
};
