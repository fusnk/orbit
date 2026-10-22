import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Tiempos de salto de anime de AniSkip",
  'movix.aniskip-hint': "En el anime, pregunta también a AniSkip, una base de datos comunitaria gratuita, dónde están los openings, endings y resúmenes. Solo envía el ID de MyAnimeList de la serie y el número de episodio; para reconocer la serie puede descargar una lista pública de IDs desde GitHub. Desactivado hasta que lo actives.",
  'movix.smooth': "Salto suave",
  'movix.smooth-hint': "Al saltar, la imagen funde a negro y el sonido baja un momento, y luego vuelven. Con Reducir movimiento activado, los saltos siguen siendo instantáneos.",
  'movix.button-delay': "Mostrar el botón Saltar tras",
  'movix.button-delay-hint': "Deja que empiece la intro o los créditos antes de que aparezca Saltar, para que el botón no tape el final de una escena. Los saltos automáticos no esperan.",
  'movix.button-delay-none': "Al instante",
  'movix.landing': "Detenerse antes del final",
  'movix.landing-hint': "El salto termina un poco antes de que acabe la intro o el resumen, para no cortar el primer momento que sigue. Los créditos que duran hasta el final siguen llevando al final.",
  'movix.landing-none': "Al final",
  'movix.color-intro': "Color de la intro",
  'movix.color-recap': "Color del resumen",
  'movix.color-credits': "Color de los créditos",
  'movix.color-preview': "Color del avance",
  'movix.colors-hint': "Cómo se ve cada parte en la barra de progreso.",
  'movix.swatch.default': "Estándar",
  'movix.swatch.amber': "Ámbar",
  'movix.swatch.sky': "Celeste",
  'movix.swatch.mint': "Menta",
  'movix.swatch.rose': "Rosa",
  'movix.swatch.violet': "Violeta",
  'movix.swatch.white': "Blanco",
};
