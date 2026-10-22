import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Meilleure correspondance',
  'subs.error.sdh': 'Impossible d’appliquer votre réglage de texte pour sourds et malentendants',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Retirer le texte pour sourds et malentendants',
  'subs.settings.strip-sdh-hint': 'Masque dans les sous-titres les descriptions de sons comme [la porte grince], les indications de musique et les noms des personnages comme JEAN :. Les lignes devenues vides sont ignorées ; le minutage ne change pas.',
  'subs.settings.keep-lyrics': 'Garder les paroles des chansons',
  'subs.settings.keep-lyrics-hint': 'Les lignes chantées marquées d’un ♪ restent quand le texte pour sourds et malentendants est retiré. Les lignes faites seulement de notes de musique sont tout de même retirées.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Impossible de garder les sous-titres en bas',
  'subs.player.position': 'Position des sous-titres',
  'subs.player.height': 'Hauteur',
  'subs.player.raised': '{value} % plus haut',
  'subs.player.reset': 'Remettre en bas',
  'subs.player.keep-bottom': 'Garder en bas',
  'subs.player.keep-bottom-hint': 'Les sous-titres simples (comme SRT) ignorent le placement du fichier : chaque ligne s’affiche à cette hauteur. Ceux intégrés à la vidéo perdent aussi leur italique. Les sous-titres stylés (ASS, courants dans les animés) gardent leur mise en page. Mémorisé pour toutes les vidéos.',
};
