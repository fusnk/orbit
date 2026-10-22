import { describe, expect, it, vi } from 'vitest';
import { otherFilmYear, streamLabels } from './stream-traits';

vi.mock('./ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));

describe('a source size', () => {
  // The German catalog is compiled on first import; alongside the rest of the suite that alone can pass the time limit.
  it('is written in Orbit’s language', { timeout: 60_000 }, async () => {
    const { setLanguage } = await import('../i18n');
    await setLanguage('de').catch(() => {});
    try {
      // German puts a no-break space before the unit.
      expect(streamLabels({ videoSize: 2.1 * 1024 ** 3 }).size).toMatch(/^2,1\sGB$/);
      expect(streamLabels({ videoSize: 700 * 1024 ** 2 }).size).toMatch(/^700\sMB$/);
    } finally {
      await setLanguage('en').catch(() => {});
    }
  });
});

describe('streamLabels', () => {
  it('ignores size text whose byte conversion overflows instead of showing Infinity GB', () => {
    const labels = streamLabels({ description: `${'9'.repeat(300)}GB` });
    expect(labels.traits.sizeGB).toBeUndefined();
    expect(labels.largestGB).toBeUndefined();
    expect(labels.size).toBeUndefined();
  });

  it('reads a typical release filename', () => {
    const labels = streamLabels({ filename: 'Movie.2024.2160p.WEB-DL.DV.HDR10.Atmos.7.1.HEVC-GRP.mkv', videoSize: 18.4 * 1024 ** 3 });
    expect(labels.traits).toMatchObject({ resolution: '2160p', hdr: 'Dolby Vision', audio: 'Atmos' });
    expect(labels).toMatchObject({ codec: 'HEVC', release: 'WEB-DL', size: '18.4 GB' });
    expect(labels.traits.sizeGB).toBeCloseTo(18.4);
  });

  it('reads multi-line addon names and sizes written in the text', () => {
    const labels = streamLabels({ name: 'Addon\n1080p', description: 'Show.S01E02.1080p.WEBRip.x264.AAC2.0\n💾 700 MB' });
    expect(labels.traits).toMatchObject({ resolution: '1080p', audio: 'Stereo' });
    expect(labels).toMatchObject({ codec: 'H.264', release: 'WEBRip', size: '700 MB' });
  });

  it('reads sizes with grouped thousands and with a decimal comma', () => {
    const gb = (description: string) => streamLabels({ description }).traits.sizeGB;
    expect(gb('💾 1,234.5 MB')).toBeCloseTo(1234.5 / 1024);
    expect(gb('💾 1,234,567 MB')).toBeCloseTo(1234567 / 1024);
    expect(gb('💾 1,5 GB')).toBeCloseTo(1.5);
    expect(gb('💾 2.1 GB')).toBeCloseTo(2.1);
    // A single comma group with no point is ambiguous: read as a decimal comma, as before.
    expect(gb('💾 1,234 GB')).toBeCloseTo(1.234);
  });

  it("doesn't read a size like 5.1 GB as surround or 2.0 GB as stereo", () => {
    expect(streamLabels({ description: 'Movie 1080p\n👤 12 💾 5.1 GB ⚙️ addon' }).traits.audio).toBeUndefined();
    expect(streamLabels({ description: 'Movie 1080p 💾 7.1GB' }).traits.audio).toBeUndefined();
    expect(streamLabels({ description: 'Movie 1080p 💾 2.0 GiB' }).traits.audio).toBeUndefined();
    // The real layout still counts when a size sits beside it.
    expect(streamLabels({ description: 'Movie.1080p.DDP2.0.x264\n💾 5.1 GB' }).traits.audio).toBe('Stereo');
    expect(streamLabels({ description: 'Movie.1080p.DDP5.1.x264 💾 5.1 GB' }).traits.audio).toBe('5.1');
  });

  it('distinguishes HDR10+ from HDR10 and 4K aliases', () => {
    expect(streamLabels({ name: '4K HDR10+' }).traits).toMatchObject({ resolution: '2160p', hdr: 'HDR10+' });
    expect(streamLabels({ name: 'UHD HDR' }).traits).toMatchObject({ resolution: '2160p', hdr: 'HDR10' });
  });

  it('does not match tokens inside other words', () => {
    // "hdtv" contains "hd"; "shdr" and "dvd" must not read as HDR or DV.
    const labels = streamLabels({ name: 'Show.HDTV.dvd-shdr.mkv' });
    expect(labels.release).toBe('HDTV');
    expect(labels.traits.hdr).toBeUndefined();
    expect(labels.traits.resolution).toBeUndefined();
  });

  it("doesn't read DTS-HD audio as a 720p picture", () => {
    expect(streamLabels({ name: 'Movie.2010.BluRay.DTS-HD.MA.5.1.x264' }).traits.resolution).toBeUndefined();
    expect(streamLabels({ name: 'Movie 2010 BluRay DTS HD MA' }).traits.resolution).toBeUndefined();
    expect(streamLabels({ name: 'Movie.2010.1080p.BluRay.DTS-HD.MA' }).traits.resolution).toBe('1080p');
    expect(streamLabels({ name: 'Movie HD' }).traits.resolution).toBe('720p');
  });

  it('reads "Full HD" as 1080p, not as plain HD', () => {
    expect(streamLabels({ name: 'Addon\nFull HD' }).traits.resolution).toBe('1080p');
    expect(streamLabels({ name: 'Movie.2010.FullHD.x264' }).traits.resolution).toBe('1080p');
    expect(streamLabels({ name: 'Movie.2010.Full-HD' }).traits.resolution).toBe('1080p');
  });

  it('leaves unknowns undefined', () => {
    expect(streamLabels({ description: 'Local server' })).toEqual({
      traits: { resolution: undefined, hdr: undefined, audio: undefined, sizeGB: undefined, words: 'local server' },
      codec: undefined,
      release: undefined,
      size: undefined,
    });
  });

  it('reads the traits source rules look at', () => {
    const remux = streamLabels({ filename: 'Movie.2019.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-MiXeDGrP.mkv' });
    expect(remux.traits).toMatchObject({ codec: 'HEVC', remux: true, lossless: true, audio: 'Atmos' });
    expect(streamLabels({ filename: 'Movie.2024.1080p.WEB-DL.AV1.Opus.mkv' }).traits.codec).toBe('AV1');
    expect(streamLabels({ filename: 'Movie.2024.FLAC.mkv' }).traits.lossless).toBe(true);
    expect(streamLabels({ filename: 'Movie.2024.DTS-HD.MA.5.1.mkv' }).traits.lossless).toBe(true);
    expect(streamLabels({ filename: 'Movie.2024.1080p.WEB.DDP5.1.mkv' }).traits.lossless).toBeUndefined();
  });

  it('spots camera and screener copies, but not a .ts file', () => {
    for (const name of ['Movie.2024.HDCAM.x264', 'Movie 2024 CAMRip', 'Movie.2024.TS.XviD', 'Movie.2024.HDTS.720p', 'Movie.2024.TELESYNC', 'Movie.2024.DVDSCR', 'Movie (2024) SCREENER', 'Movie.2024.HD-TC']) {
      expect(streamLabels({ name }).traits.cam, name).toBe(true);
    }
    for (const name of ['Recording.ts', 'Movie.2024.1080p.WEB-DL.mkv', 'Webcam.Diaries.2024.1080p', 'Show.S01E02.mts']) {
      expect(streamLabels({ filename: name }).traits.cam, name).toBeUndefined();
    }
  });

  it('does not take a release group called TC or TS after the codecs for a cinema copy', () => {
    for (const name of ['Film.2024.1080p.WEB-DL.AAC.2.0.H.264-TC', 'Film.2024.1080p.WEB-DL.DDP5.1.x264-TS.mkv', 'Film.2024.1080p.BluRay.HEVC-TC']) {
      expect(streamLabels({ name }).traits.cam, name).toBeUndefined();
    }
    for (const name of ['Film.2024.TC.1080p.x264-GRP', 'Film.2024.TELECINE.x264-GRP', 'Film.2024.HD-TC.x264', 'Film.2024.720p.TS.x264-GRP']) {
      expect(streamLabels({ name }).traits.cam, name).toBe(true);
    }
  });

  it('spots 3D and multi-audio releases, but not multi-subtitles', () => {
    expect(streamLabels({ filename: 'Avatar.2009.1080p.3D.HSBS.BluRay.mkv' }).traits.threeD).toBe(true);
    expect(streamLabels({ filename: 'Movie.2024.Half-OU.mkv' }).traits.threeD).toBe(true);
    expect(streamLabels({ filename: 'Movie.2024.1080p.mkv' }).traits.threeD).toBeUndefined();
    expect(streamLabels({ filename: 'Movie.2024.MULTi.1080p.mkv' }).traits.multiAudio).toBe(true);
    expect(streamLabels({ description: 'Dual Audio 1080p' }).traits.multiAudio).toBe(true);
    expect(streamLabels({ filename: 'Movie.2024.1080p.Multi-Subs.mkv' }).traits.multiAudio).toBeUndefined();
  });

  it('reads cached markers from debrid addons, never from "uncached"', () => {
    expect(streamLabels({ name: '[RD+] Addon A\n4k' }).traits.cached).toBe(true);
    expect(streamLabels({ name: '[TB+] Addon A' }).traits.cached).toBe(true);
    expect(streamLabels({ name: '[RD⚡] Addon B 4K' }).traits.cached).toBe(true);
    expect(streamLabels({ name: 'Addon C | RD ⚡️' }).traits.cached).toBe(true);
    expect(streamLabels({ name: 'Instant · 1080p' }).traits.cached).toBe(true);
    expect(streamLabels({ name: 'Addon A', description: 'Instant.Neighbours.2019.1080p' }).traits.cached).toBeUndefined();
    expect(streamLabels({ name: 'Addon D', description: '⚡ 1080p' }).traits.cached).toBe(true);
    expect(streamLabels({ name: '[RD download] Addon A' }).traits.cached).toBeUndefined();
    expect(streamLabels({ name: 'Uncached 1080p' }).traits.cached).toBeUndefined();
    expect(streamLabels({ name: 'Not cached' }).traits.cached).toBeUndefined();
    // Only the addon's own label counts, not a filename.
    expect(streamLabels({ filename: 'Cached.Movie.mkv' }).traits.cached).toBeUndefined();
  });

  it('reads uncached markers from the name only; a cached mark wins', () => {
    expect(streamLabels({ name: '[RD download] Addon A\n1080p' }).traits.uncached).toBe(true);
    expect(streamLabels({ name: '[RD⬇️] Addon B 4K' }).traits.uncached).toBe(true);
    expect(streamLabels({ name: 'Addon C | RD ⏳ 1080p' }).traits.uncached).toBe(true);
    expect(streamLabels({ name: 'Uncached 1080p' }).traits.uncached).toBe(true);
    expect(streamLabels({ name: 'Not cached' }).traits.uncached).toBe(true);
    expect(streamLabels({ name: '[RD+] Addon A' }).traits.uncached).toBeUndefined();
    expect(streamLabels({ name: 'Addon A', description: 'Movie.Download.2024.1080p ⏳' }).traits.uncached).toBeUndefined();
    expect(streamLabels({ filename: 'Uncached.Movie.mkv' }).traits.uncached).toBeUndefined();
  });

  it('keeps the larger of the hinted and shown sizes for limits', () => {
    const labels = streamLabels({ description: '💾 10.1 GB', videoSize: 9.9 * 1024 ** 3 });
    expect(labels.traits.sizeGB).toBeCloseTo(9.9);
    expect(labels.largestGB).toBeCloseTo(10.1);
    expect(streamLabels({ videoSize: 2 * 1024 ** 3 }).largestGB).toBeCloseTo(2);
    expect(streamLabels({ name: '1080p' }).largestGB).toBeUndefined();
  });

  it('keeps the text as plain words for keywords', () => {
    expect(streamLabels({ name: 'Addon\n4K', filename: 'Movie.2024.WEB-DL-NOVA.mkv' }).traits.words).toBe('movie 2024 web dl nova mkv addon 4k');
  });
});

describe('cinema and preview copies', () => {
  const copy = (name: string) => streamLabels({ name }).copy;
  it('names the kind, most specific first', () => {
    expect(copy('Harbor.Point.2026.1080p.HDTS.x264')).toBe('TS');
    expect(copy('Movie 2026 TELESYNC 720p')).toBe('TS');
    expect(copy('Movie.2026.HDCAM.x264')).toBe('CAM');
    expect(copy('Movie 2026 CAMRip')).toBe('CAM');
    expect(copy('Movie.2026.TC.1080p')).toBe('TC');
    expect(copy('Movie.2026.DVDSCR.x264')).toBe('SCR');
  });
  it('spots a telecine written as one word, as HDTS is', () => {
    expect(copy('Movie.2026.1080p.HDTC.x264')).toBe('TC');
    expect(copy('Movie 2026 HDTC 720p')).toBe('TC');
    expect(streamLabels({ name: 'Movie.2026.HDTC.x264' }).traits.cam).toBe(true);
  });
  it('leaves real releases and .ts files alone', () => {
    expect(copy('Movie.2026.1080p.WEB-DL.DDP5.1.H.264')).toBeUndefined();
    expect(copy('Movie.2026.2160p.BluRay.REMUX.mkv')).toBeUndefined();
    expect(streamLabels({ name: 'x', filename: 'Movie.2026.1080p.WEB.ts' }).copy).toBeUndefined();
  });
});

describe("another film's sources", () => {
  const years = (name: string) => streamLabels({ name }).years;
  it('spots a different year', () => {
    expect(otherFilmYear(years('Harbor.Point.Reckoning.2012.1080p.BluRay'), 2026)).toBe(2012);
    expect(otherFilmYear(years('Harbor Point Welcome to Saltmarsh 2021 1080p'), 2026)).toBe(2021);
  });
  it('accepts the film, a year off, a title with a year in it, and names without one', () => {
    expect(otherFilmYear(years('Harbor.Point.2026.1080p.WEB-DL'), 2026)).toBeUndefined();
    expect(otherFilmYear(years('Movie.2025.1080p'), 2026)).toBeUndefined();
    expect(otherFilmYear(years('Blade.Runner.2049.2017.2160p'), 2017)).toBeUndefined();
    expect(otherFilmYear(years('Harbor Point 1080p HDTS'), 2026)).toBeUndefined();
    expect(otherFilmYear(years('Movie.1080p.x264'), 2026)).toBeUndefined();
    expect(otherFilmYear(years('Movie.2012.1080p'), undefined)).toBeUndefined();
  });
  it("doesn't read seeders or sizes as years", () => {
    const labels = (description: string) => streamLabels({ name: 'Addon A\n1080p', description }).years;
    expect(otherFilmYear(labels('Example Film 1080p BluRay\n👤 2025 💾 2.1 GB ⚙️ addon-a.example'), 2010)).toBeUndefined();
    expect(otherFilmYear(labels('Example Film 1080p\n👥 1998 💾 1.4 GB'), 2010)).toBeUndefined();
    expect(otherFilmYear(labels('Example Film 1080p WEB\nSize: 2048 MB · Seeders: 2001'), 2010)).toBeUndefined();
    expect(otherFilmYear(labels('Example.Film.2010.1080p.BluRay\n👤 2025 💾 1950 MB'), 2010)).toBeUndefined();
    // The film's own year is still read next to them.
    expect(otherFilmYear(labels('Other.Film.2003.1080p\n👤 2010 💾 2.1 GB'), 2010)).toBe(2003);
  });
});
