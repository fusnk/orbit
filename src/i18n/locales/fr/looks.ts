import type { looks as source } from '../en/looks';
import type { Catalog } from '../types';

/** French strings for Looks (whole-app style presets). */
export const looks: Catalog<typeof source> = {
  'looks.heading': 'Styles',
  'looks.hint': 'Un seul choix qui rhabille tout Orbit : le thème, la bannière de l’accueil, la page du titre, l’emplacement du menu et la disposition du lecteur. Tout ce qu’un style règle reste modifiable ci-dessous.',
  'looks.presets-label': 'Styles',
  'looks.name.orbit': 'Orbit',
  'looks.name.crimson': 'Crimson',
  'looks.name.marquee': 'Marquee',
  'looks.name.premiere': 'Premiere',
  'looks.name.glass': 'Glass',
  'looks.name.aurora': 'Aurora',
  'looks.name.couch': 'Couch',
  'looks.name.afterglow': 'Afterglow',
  'looks.name.arc': 'Orbit Arc',
  'looks.orbit-hint': 'Orbit tel qu’il est livré : le thème d’origine, une bannière en carte, le menu en haut et le lecteur classique.',
  'looks.crimson-hint': 'Du noir et un seul rouge cinéma, une bannière pleine largeur, des cartes en paysage, la page de titre Vitrine et le lecteur Théâtre.',
  'looks.custom': 'Personnalisé',
  'looks.restore': 'Rétablir ma configuration précédente',
  'looks.applied': '{name} appliqué.',
  'looks.restored': 'Votre configuration précédente est de retour.',
};
