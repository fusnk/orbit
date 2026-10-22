import type { tonight as source } from '../en/tonight';
import type { Catalog } from '../types';

export const tonight: Catalog<typeof source> = {
  'tonight.title': 'Ce soir',
  'tonight.open': 'Ce soir',
  'tonight.palette': 'Ce soir : quoi regarder',
  'tonight.intro': 'Combien de temps avez-vous, et de quoi avez-vous envie ?',
  'tonight.time': 'Durée',
  'tonight.time-30': '30 min',
  'tonight.time-60': '1 heure',
  'tonight.time-90': '90 min',
  'tonight.time-120': '2 heures ou plus',
  'tonight.mood': 'Humeur',
  'tonight.mood.light': 'Léger',
  'tonight.mood.intense': 'Intense',
  'tonight.mood.cozy': 'Douillet',
  'tonight.mood.mind-bending': 'Déroutant',
  'tonight.picks': 'Suggestions',
  'tonight.from.library': 'Dans votre bibliothèque',
  'tonight.another-label': 'Proposer autre chose à la place de {name}',
  'tonight.no-more': 'Rien d’autre ne correspond à ces choix.',
  'tonight.loading': 'Recherche parmi ce que vous avez…',
  'tonight.updated': 'Suggestions mises à jour.',
  'tonight.none': 'Rien ne correspond pour l’instant',
  'tonight.none-body': 'Essayez plus de temps ou une autre humeur. Ce soir ne choisit que dans Reprendre la lecture, votre bibliothèque et les catalogues déjà ouverts.',
};
