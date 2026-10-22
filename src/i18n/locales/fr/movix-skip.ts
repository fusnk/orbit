import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Passages anime à sauter (AniSkip)",
  'movix.aniskip-hint': "Pour les anime, demande aussi à AniSkip, une base de données communautaire gratuite, où se trouvent les openings, endings et résumés. N’envoie que l’identifiant MyAnimeList de la série et le numéro d’épisode ; pour reconnaître la série, une liste publique d’identifiants peut être téléchargée depuis GitHub. Désactivé tant que vous ne l’activez pas.",
  'movix.smooth': "Saut en fondu",
  'movix.smooth-hint': "Lors d’un saut, l’image passe un instant au noir et le son baisse, puis tout revient en fondu. Avec « Réduire les animations », les sauts restent instantanés.",
  'movix.button-delay': "Afficher le bouton Passer après",
  'movix.button-delay-hint': "Laisse le début du générique se jouer avant d’afficher Passer, pour que le bouton ne cache pas la fin d’une scène. Les sauts automatiques n’attendent pas.",
  'movix.button-delay-none': "Tout de suite",
  'movix.landing': "Reprendre avant la fin",
  'movix.landing-hint': "Un saut s’arrête un peu avant la fin du générique ou du résumé, pour ne pas couper le premier instant qui suit. Un générique de fin qui dure jusqu’au bout mène toujours à la fin.",
  'movix.landing-none': "À la fin",
  'movix.color-intro': "Couleur du générique",
  'movix.color-recap': "Couleur du résumé",
  'movix.color-credits': "Couleur du générique de fin",
  'movix.color-preview': "Couleur de l’aperçu",
  'movix.colors-hint': "L’aspect de chaque partie sur la barre de lecture.",
  'movix.swatch.default': "Standard",
  'movix.swatch.amber': "Ambre",
  'movix.swatch.sky': "Bleu ciel",
  'movix.swatch.mint': "Menthe",
  'movix.swatch.rose': "Rose",
  'movix.swatch.violet': "Violet",
  'movix.swatch.white': "Blanc",
};
