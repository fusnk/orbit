import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Anime-Skip-Zeiten von AniSkip",
  'movix.aniskip-hint': "Fragt bei Anime zusätzlich AniSkip, eine kostenlose Community-Datenbank, wo Openings, Endings und Rückblicke liegen. Sendet nur die MyAnimeList-ID der Serie und die Folgennummer; um die Serie zuzuordnen, kann eine öffentliche ID-Liste von GitHub geladen werden. Aus, bis du es einschaltest.",
  'movix.smooth': "Sanftes Überspringen",
  'movix.smooth-hint': "Blendet beim Überspringen das Bild kurz zu Schwarz und den Ton herunter und danach beides wieder ein. Mit „Bewegung reduzieren“ wird sofort gesprungen.",
  'movix.button-delay': "Überspringen-Taste zeigen nach",
  'movix.button-delay-hint': "Lässt den Anfang von Intro oder Abspann laufen, bevor „Überspringen“ erscheint, damit die Taste nicht das Ende einer Szene verdeckt. Automatisches Überspringen wartet nicht darauf.",
  'movix.button-delay-none': "Sofort",
  'movix.landing': "Vor dem Ende landen",
  'movix.landing-hint': "Ein Sprung landet so viel vor dem Ende von Intro oder Rückblick, damit der erste Moment danach nicht fehlt. Ein Abspann bis zum Schluss springt weiterhin ans Ende.",
  'movix.landing-none': "Am Ende",
  'movix.color-intro': "Farbe für Intro",
  'movix.color-recap': "Farbe für Rückblick",
  'movix.color-credits': "Farbe für Abspann",
  'movix.color-preview': "Farbe für Vorschau",
  'movix.colors-hint': "Wie jeder Teil auf der Zeitleiste aussieht.",
  'movix.swatch.default': "Standard",
  'movix.swatch.amber': "Bernstein",
  'movix.swatch.sky': "Himmelblau",
  'movix.swatch.mint': "Mint",
  'movix.swatch.rose': "Rosa",
  'movix.swatch.violet': "Violett",
  'movix.swatch.white': "Weiß",
};
