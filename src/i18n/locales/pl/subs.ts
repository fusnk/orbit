import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Najlepsze dopasowanie',
  'subs.error.sdh': 'Nie udało się zastosować ustawienia tekstu dla niesłyszących',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Usuwaj tekst dla niesłyszących',
  'subs.settings.strip-sdh-hint': 'Ukrywa w napisach opisy dźwięków, takie jak [skrzypią drzwi], oznaczenia muzyki i imiona mówiących, takie jak JAN:. Linie, które zostaną puste, są pomijane; czas wyświetlania się nie zmienia.',
  'subs.settings.keep-lyrics': 'Zachowuj teksty piosenek',
  'subs.settings.keep-lyrics-hint': 'Śpiewane linie oznaczone ♪ zostają, gdy tekst dla niesłyszących jest usuwany. Linie z samymi nutami i tak znikają.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Nie udało się utrzymać napisów na dole',
  'subs.player.position': 'Położenie napisów',
  'subs.player.height': 'Wysokość',
  'subs.player.raised': '{value}% wyżej',
  'subs.player.reset': 'Przywróć na dół',
  'subs.player.keep-bottom': 'Trzymaj na dole',
  'subs.player.keep-bottom-hint': 'Proste napisy (np. SRT) pomijają położenie z pliku, więc każda linia jest na tej wysokości. Proste napisy wbudowane w film tracą też kursywę. Napisy ze stylami (ASS, częste w anime) zachowują własny układ. Zapamiętywane dla wszystkich filmów.',
};
