/**
 * A title's best available picture and sound, as badges for its page:
 * "4K", "Dolby Vision", "HDR10+" or "HDR10", "Atmos", "DTS:X". Worked out
 * from the traits its sources' names say they have, so a badge only shows
 * when at least one source claims it; nothing is guessed from the title.
 */
import type { SourceTraits } from './ranking-fallback';
import { streamLabels } from './stream-traits';

export type QualityBadge = '4K' | 'Dolby Vision' | 'HDR10+' | 'HDR10' | 'Atmos' | 'DTS:X';

/** What one source offers, as far as the badges care. */
export interface QualityTraits {
  traits: Pick<SourceTraits, 'resolution' | 'hdr' | 'audio' | 'cam'>;
  dtsX?: boolean | undefined;
}

// Release names write it "DTS-X", "DTS.X" or "DTSX"; addons' own labels "DTS:X".
const DTS_X = /(?:^|[^a-z0-9])dts[ .:-]?x(?:$|[^a-z0-9])/i;

/** A stream's traits for the badges, read from its name, description and filename. */
export function qualityTraits(stream: { name?: string | undefined; description?: string | undefined; filename?: string | undefined }): QualityTraits {
  const text = [stream.filename, stream.name, stream.description].filter(Boolean).join(' \n ');
  return { traits: streamLabels(stream).traits, dtsX: DTS_X.test(text) };
}

/**
 * The badges, in a fixed order. Cinema copies are left out (a "4K" camera
 * recording isn't a 4K film). Dolby Vision and HDR10 are separate badges as
 * they need different screens; of HDR10+ and HDR10 only the better shows.
 */
export function qualityBadges(sources: readonly QualityTraits[]): QualityBadge[] {
  const real = sources.filter((s) => !s.traits.cam);
  const any = (test: (s: QualityTraits) => boolean | undefined) => real.some(test);
  const badges: QualityBadge[] = [];
  if (any((s) => s.traits.resolution === '2160p')) badges.push('4K');
  if (any((s) => s.traits.hdr === 'Dolby Vision')) badges.push('Dolby Vision');
  if (any((s) => s.traits.hdr === 'HDR10+')) badges.push('HDR10+');
  else if (any((s) => s.traits.hdr === 'HDR10')) badges.push('HDR10');
  if (any((s) => s.traits.audio === 'Atmos')) badges.push('Atmos');
  if (any((s) => s.dtsX)) badges.push('DTS:X');
  return badges;
}
