import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoilers',
  'spoilers.intro': 'Ce qu’il faut cacher des épisodes : sur la page d’une série, dans la liste d’épisodes du lecteur, sur la carte À suivre et dans Reprendre la lecture.',
  'spoilers.titles': 'Masquer les titres des épisodes',
  'spoilers.titles-hint': 'Affiche « Épisode 4 » à la place du nom de l’épisode.',
  'spoilers.descriptions': 'Masquer les descriptions des épisodes',
  'spoilers.descriptions-hint': 'Omet le résumé de chaque épisode.',
  'spoilers.thumbnails': 'Flouter les images des épisodes',
  'spoilers.thumbnails-hint': 'Survolez ou sélectionnez un épisode pour jeter un œil.',
  'spoilers.ratings': 'Masquer les notes des épisodes',
  'spoilers.ratings-hint': 'Une note peut trahir les épisodes qui comptent.',
  'spoilers.unaired': 'Masquer les dates de diffusion des épisodes à venir',
  'spoilers.unaired-hint': 'Les épisodes pas encore sortis indiquent seulement « Pas encore diffusé ».',
  'spoilers.scope': 'S’applique à',
  'spoilers.scope-hint': 'Les épisodes terminés ou commencés montrent tout, sauf si vous choisissez tous les épisodes.',
  'spoilers.scope-unwatched': 'Les épisodes que je n’ai pas vus',
  'spoilers.scope-all': 'Tous les épisodes',
};
