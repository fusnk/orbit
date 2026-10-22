import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Déposer pour lire',
  'local.drop.video-hint': 'La vidéo est lue dans Orbit.',
  'local.drop.subtitle-hint': 'Les sous-titres sont ajoutés à la lecture en cours.',
  'local.drop.first-only': 'Lecture de {name}. Orbit lit un fichier à la fois, les autres ont donc été ignorés.',
  'local.drop.failed': 'Impossible d’ouvrir ce fichier.',
  'local.drop.unsupported': 'Orbit ne peut pas lire ce type de fichier.',
  'local.drop.subtitle-needs-player': 'Lancez d’abord une vidéo, puis déposez-y les sous-titres.',
  'local.drop.subtitle-added': 'Sous-titres ajoutés : {name}',
  'local.drop.subtitle-first-only': 'Sous-titres ajoutés : {name}. Seul le premier fichier a été utilisé.',
  'local.drop.subtitle-failed': 'Impossible d’ajouter ces sous-titres.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'ce PC',
  'local.source.label': 'Fichier local',
  // Settings → Player → External player
  'local.external.heading': 'Lecteur externe',
  'local.external.player': 'Ouvrir les sources dans',
  'local.external.player-hint': 'Ajoute « Ouvrir dans le lecteur externe » aux sources web du sélecteur de sources. La reprise, le saut de générique, les pistes mémorisées et la progression ne fonctionnent que dans le lecteur d’Orbit.',
  'local.external.none': 'Aucun',
  'local.external.custom': 'Personnalisé',
  'local.external.found': 'Trouvé : {path}',
  'local.external.not-found': 'Introuvable dans son dossier d’installation habituel. Choisissez Personnalisé pour indiquer son emplacement.',
  'local.external.custom-path': 'Programme',
  'local.external.custom-path-hint': 'Le fichier programme du lecteur, choisi sur ce PC.',
  'local.external.choose': 'Choisir…',
  'local.external.custom-invalid': 'Orbit ne peut pas lancer cela. Choisissez le fichier programme du lecteur.',
  'local.external.always': 'Toujours ouvrir dans le lecteur externe',
  'local.external.always-hint': 'Le bouton Lecture lui envoie directement la meilleure source web. Les torrents et les téléchargements restent lus dans Orbit.',
  // The source picker
  'local.external.open': 'Externe',
  'local.external.open-label': 'Ouvrir dans le lecteur externe',
  'local.external.opened': 'Ouvert dans le lecteur externe.',
  'local.external.failed': 'Le lecteur externe n’a pas démarré. Vérifiez Réglages → Lecteur.',
};
