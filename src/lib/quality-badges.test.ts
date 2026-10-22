import { describe, expect, it } from 'vitest';
import { qualityBadges, qualityTraits } from './quality-badges';

const from = (...names: string[]) => qualityBadges(names.map((name) => qualityTraits({ name })));

describe('qualityBadges', () => {
  it('shows nothing without sources, or when no source claims anything', () => {
    expect(qualityBadges([])).toEqual([]);
    expect(from('Movie.2020.1080p.WEB-DL.x264', 'Movie 720p')).toEqual([]);
  });

  it('takes the best each source offers, in a fixed order', () => {
    expect(from('Movie.2020.1080p.TrueHD.Atmos.7.1', 'Movie.2020.2160p.DV.HEVC', 'Movie.2020.2160p.HDR10.DDP5.1')).toEqual(['4K', 'Dolby Vision', 'HDR10', 'Atmos']);
  });

  it('shows Dolby Vision and HDR10 apart, but only the better of HDR10+ and HDR10', () => {
    expect(from('Movie 2160p HDR10', 'Movie 2160p HDR10+')).toEqual(['4K', 'HDR10+']);
    expect(from('Movie 2160p DoVi', 'Movie 2160p HDR')).toEqual(['4K', 'Dolby Vision', 'HDR10']);
  });

  it('finds DTS:X however it is written', () => {
    expect(from('Movie.2160p.DTS-X.7.1')).toEqual(['4K', 'DTS:X']);
    expect(from('Movie 1080p DTS:X')).toEqual(['DTS:X']);
    expect(from('Movie 1080p DTS-HD MA 5.1')).toEqual([]);
  });

  it('never counts a cinema copy', () => {
    expect(from('Movie.2020.2160p.HDCAM.Atmos')).toEqual([]);
    expect(from('Movie.2020.2160p.HDCAM', 'Movie.2020.1080p.WEB-DL')).toEqual([]);
  });

  it('reads the filename and description too', () => {
    expect(qualityBadges([qualityTraits({ name: 'Addon\n4K', description: 'Some.Movie.HDR10plus.Atmos', filename: 'Some.Movie.2160p.mkv' })])).toEqual(['4K', 'HDR10+', 'Atmos']);
  });
});
