import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Dutch strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Uitvoerapparaat",
  'audiodevice.hint': "Waar het geluid wordt afgespeeld. Systeemstandaard volgt de keuze van je computer, ook als die tijdens een video verandert. Wordt het hier gekozen apparaat losgekoppeld, dan gaat het geluid naar de systeemstandaard tot het terug is.",
  'audiodevice.default': "Systeemstandaard",
  'audiodevice.missing': "Niet verbonden: speelt af via de systeemstandaard",
  'audiodevice.error': "Kan het uitvoerapparaat niet wijzigen",
};
