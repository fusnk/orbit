import type { quick as source } from '../en/quick';
import type { Catalog } from '../types';

export const quick: Catalog<typeof source> = {
  'quick.button': "Réglages rapides",
  'quick.heading': "Réglages rapides",
  'quick.switch-profile': "Changer de profil",
  'quick.pause-history': "Suspendre l’historique",
  'quick.pause-history-hint': "Ce que vous regardez n’est pas ajouté à votre historique ni à Reprendre la lecture, et n’est pas envoyé à Stremio, Jellyfin ou Plex.",
  'quick.look': "Style",
  'quick.look-custom': "Personnalisé",
  'quick.trailers': "Lecture automatique des bandes-annonces",
  'quick.trailers-partly': 'Activé seulement sur les pages de titres ou les bannières. L’activer les lance dans les deux.',
  'quick.skip-intros': 'Passer les génériques de début automatiquement',
  'quick.all-settings': "Tous les réglages",
  'quick.chip': "Historique suspendu",
  'quick.chip-label': "L’historique est suspendu. Ouvrir les réglages rapides",
  'quick.paused': "Historique suspendu. Ce que vous regardez maintenant ne laisse aucune trace.",
  'quick.resumed': "L’historique est de nouveau actif.",
  'quick.palette.pause': "Suspendre l’historique",
  'quick.palette.resume': "Reprendre l’historique",
};
