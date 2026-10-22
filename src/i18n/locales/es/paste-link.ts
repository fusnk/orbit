import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Spanish strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Reproducir este enlace",
  'pastelink.play-magnet': "Reproducir este enlace magnet",
  'pastelink.magnet': "Enlace magnet",
  'pastelink.source': "Enlace pegado",
  'pastelink.detail': "Se abre en el reproductor. No se guarda nada en tu historial.",
  'pastelink.torrents-off.title': "Los enlaces magnet necesitan los torrents activados",
  'pastelink.torrents-off.detail': "Orbit reproduce enlaces magnet con su propio reproductor de torrents, que está desactivado. Puedes activar los torrents en Ajustes.",
  'pastelink.torrents-off.open': "Abrir Ajustes",
};
