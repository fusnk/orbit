import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "Amplificación de volumen",
  'trybox.boost.note': "Un limitador evita que el audio amplificado se sature.",
  'trybox.boost.off': "Desactivada",
  'trybox.boost.passthrough': "Desactiva el paso directo de audio para amplificar el volumen.",
  'trybox.controls.title': "Tamaño de los controles",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "Pequeño",
  'trybox.controls.medium': "Mediano",
  'trybox.controls.large': "Grande",
  'trybox.info.pin': "Mostrar información de reproducción en pantalla",
  'trybox.info.dropped': "Fotogramas descartados",
  'trybox.info.fps': "Frecuencia de fotogramas",
  'trybox.hub.shortcuts': "Atajos",
  'trybox.hub.controls': "Tamaño de los controles",
  'trybox.hub.info': "Información en pantalla",
  'trybox.subtitle.sample': "Los subtítulos se verán así.",
  'trybox.subtitle.font': "Fuente",
};
