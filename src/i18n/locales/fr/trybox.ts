import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "Amplification du volume",
  'trybox.boost.note': "Un limiteur empêche la saturation du son amplifié.",
  'trybox.boost.off': "Désactivée",
  'trybox.boost.passthrough': "Désactivez la transmission directe du son pour amplifier le volume.",
  'trybox.controls.title': "Taille des commandes",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "Petite",
  'trybox.controls.medium': "Moyenne",
  'trybox.controls.large': "Grande",
  'trybox.info.pin': "Afficher les informations de lecture à l’écran",
  'trybox.info.dropped': "Images perdues",
  'trybox.info.fps': "Fréquence d’images",
  'trybox.hub.shortcuts': "Raccourcis",
  'trybox.hub.controls': "Taille des commandes",
  'trybox.hub.info': "Infos à l’écran",
  'trybox.subtitle.sample': "Les sous-titres auront cet aspect.",
  'trybox.subtitle.font': "Police",
};
