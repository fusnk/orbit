import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Limites de lecture automatique',
  'sources.limits.any': 'Toutes',
  'sources.limits.min-quality': 'La lecture automatique ne démarre pas en dessous de',
  'sources.limits.min-quality-hint': 'Lecture et l’épisode suivant ne lancent que des sources au moins de cette qualité (celles qui ne l’indiquent pas sont exclues). Si aucune ne convient, la meilleure est lue et Orbit vous le signale. La liste des sources montre toujours tout. Pour ce profil.',
  'sources.limits.max-quality': 'La lecture automatique ne démarre pas au-dessus de',
  'sources.limits.max-quality-hint': 'Lecture et l’épisode suivant ne lancent pas de source au-dessus, sauf s’il n’y a rien d’autre. Contrairement à « Qualité maximale à privilégier », la liste des sources n’est pas réordonnée. Pour ce profil.',
  'sources.limits.max-size': 'La lecture automatique ne lance pas de fichiers de plus de',
  'sources.limits.max-size-hint': 'Pour une connexion lente ou un forfait limité : Lecture et l’épisode suivant ignorent les fichiers plus lourds. Les sources qui ne donnent pas leur taille ne sont pas concernées. Pour ce profil.',
  'sources.autoplay.outside-limits': 'Rien ne respecte vos limites de lecture automatique : la meilleure source est lue.',
  'sources.autoplay.only-uncached': 'Toutes les sources trouvées sont encore en téléchargement sur votre service debrid. Choisissez-en une pour la lancer.',
  'sources.note.uncached': 'Pas en cache',
  'sources.note.uncached-hint': 'Encore en téléchargement sur votre service debrid : jamais lancée automatiquement',
  'sources.note.outside-limits': 'Hors limites',
  'sources.note.outside-limits-hint': 'Lecture et l’épisode suivant la passent (Réglages → Add-ons et sources → Préférences de sources → Limites de lecture automatique)',
  'sources.next-up.unaired': 'À suivre · date de diffusion non confirmée',
};
