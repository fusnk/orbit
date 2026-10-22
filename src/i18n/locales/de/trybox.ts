import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "Lautstärkeverstärkung",
  'trybox.boost.note': "Ein Begrenzer verhindert, dass verstärkter Ton übersteuert.",
  'trybox.boost.off': "Aus",
  'trybox.boost.passthrough': "Deaktiviere die direkte Audioausgabe, um die Lautstärke zu verstärken.",
  'trybox.controls.title': "Größe der Bedienelemente",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "Klein",
  'trybox.controls.medium': "Mittel",
  'trybox.controls.large': "Groß",
  'trybox.info.pin': "Wiedergabeinformationen auf dem Bildschirm anzeigen",
  'trybox.info.dropped': "Verworfene Bilder",
  'trybox.info.fps': "Bildrate",
  'trybox.hub.shortcuts': "Tastenkürzel",
  'trybox.hub.controls': "Größe der Bedienelemente",
  'trybox.hub.info': "Infos auf dem Bildschirm",
  'trybox.subtitle.sample': "So werden Untertitel aussehen.",
  'trybox.subtitle.font': "Schriftart",
};
