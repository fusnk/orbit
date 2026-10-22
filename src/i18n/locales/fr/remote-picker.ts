import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** French strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Parcourir',
  'remote.phone.browse-loading': 'Chargement de votre accueil…',
  'remote.phone.browse-empty': 'Rien à afficher pour l’instant. Ajoutez un add-on de catalogue dans Orbit pour remplir l’accueil.',
  'remote.phone.browse-failed': 'Impossible de charger votre accueil. Réessayez.',
  'remote.phone.refresh': 'Actualiser',
  'remote.phone.moods': 'Vous êtes d’humeur à quoi ?',
  'remote.phone.mood-loading': 'Recherche de suggestions…',
  'remote.phone.mood-empty': 'Aucune suggestion pour cette humeur pour le moment.',
  'remote.phone.surprise': 'Surprenez-moi',
  'remote.phone.surprise-hint': 'Une suggestion au hasard dans vos catalogues.',
  'remote.phone.surprise-movie': 'Un film',
  'remote.phone.surprise-series': 'Une série',
  'remote.phone.surprise-none': 'Rien de nouveau à suggérer pour le moment. Essayez l’autre type, ou modifiez les choix de « Surprenez-moi » dans Orbit.',
  'remote.phone.details-loading': 'Chargement des détails…',
  'remote.phone.details-failed': 'Impossible de charger ce titre. Réessayez.',
  'remote.phone.add-library': 'Ajouter à la bibliothèque',
  'remote.phone.in-library': 'Dans votre bibliothèque',
  'remote.phone.close': 'Fermer',
  'remote.phone.season': 'Saison {number}',
  'remote.phone.specials': 'Épisodes spéciaux',
  'remote.phone.episodes': 'Épisodes',
  'remote.phone.rating': 'Note IMDb {rating}',
};
