import { describe, expect, it } from 'vitest';
import { rgba } from './subtitle-css';
import { DEFAULT_SUBTITLE_STYLE, parseSubtitleStyle, subtitleOverride } from './subtitle-style';

describe('subtitleOverride', () => {
  const inside = (codec: string | null) => ({ codec, external: false });
  const added = (codec: string | null) => ({ codec, external: true });

  it('strips plain text subtitles inside the video while kept at the bottom', () => {
    for (const codec of ['subrip', 'srt', 'webvtt', 'mov_text', 'text', 'SubRip']) expect(subtitleOverride(true, inside(codec))).toBe('strip');
  });

  it('keeps the italics of added files (Rust took their placement tags out)', () => {
    for (const codec of ['subrip', 'webvtt']) expect(subtitleOverride(true, added(codec))).toBe('scale');
  });

  it('never touches styled or picture subtitles', () => {
    for (const codec of ['ass', 'ssa', 'hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'eia_608', '', null]) {
      expect(subtitleOverride(true, inside(codec))).toBe('scale');
      expect(subtitleOverride(true, added(codec))).toBe('scale');
    }
    expect(subtitleOverride(true, undefined)).toBe('scale');
  });

  it('leaves every subtitle alone when switched off', () => {
    expect(subtitleOverride(false, inside('subrip'))).toBe('scale');
    expect(subtitleOverride(false, inside('ass'))).toBe('scale');
  });
});

describe('subtitle position', () => {
  it('is at the bottom, kept there, by default', () => {
    expect(DEFAULT_SUBTITLE_STYLE.position).toBe(100);
    expect(DEFAULT_SUBTITLE_STYLE.keepBottom).toBe(true);
    expect(parseSubtitleStyle({}).keepBottom).toBe(true);
  });

  it('keeps any whole step from half way up to the bottom, including the old choices', () => {
    for (const position of [50, 73, 86, 94, 100]) expect(parseSubtitleStyle({ position }).position).toBe(position);
    for (const position of [49, 101, 150, 0, -5, 90.5, '90', NaN, Infinity, null]) expect(parseSubtitleStyle({ position }).position).toBe(100);
  });

  it('only turns "keep at the bottom" off when saved as false', () => {
    expect(parseSubtitleStyle({ keepBottom: false }).keepBottom).toBe(false);
    for (const keepBottom of [true, 0, 'no', null, undefined]) expect(parseSubtitleStyle({ keepBottom }).keepBottom).toBe(true);
  });
});

describe('subtitle font', () => {
  it("is mpv's default unless a bundled readability font is saved", () => {
    expect(DEFAULT_SUBTITLE_STYLE.font).toBe('default');
    for (const font of ['atkinson', 'lexend', 'opendyslexic', 'arimo']) expect(parseSubtitleStyle({ font }).font).toBe(font);
    // Never a free-form family name: Rust only accepts the ids above.
    for (const font of ['Comic Sans', 'ATKINSON', '', 0, null, undefined]) expect(parseSubtitleStyle({ font }).font).toBe('default');
  });
});

describe('subtitle size, opacity and colours', () => {
  it('keeps the box Orbit always drew, and full-opacity text, by default', () => {
    expect(parseSubtitleStyle({})).toMatchObject({ size: 55, opacity: 100, backColor: '#000000', backOpacity: 70, outlineColor: '#000000' });
  });

  it('takes any size in slider steps within mpv’s range, old presets included', () => {
    for (const size of [20, 40, 55, 65, 90, 120]) expect(parseSubtitleStyle({ size }).size).toBe(size);
    for (const size of [15, 125, 57, 55.5, '55', null]) expect(parseSubtitleStyle({ size }).size).toBe(55);
  });

  it('keeps opacities in their range and steps; text never fades away', () => {
    expect(parseSubtitleStyle({ opacity: 60, backOpacity: 0 })).toMatchObject({ opacity: 60, backOpacity: 0 });
    for (const opacity of [0, 20, 101, 62, -5, '80']) expect(parseSubtitleStyle({ opacity }).opacity).toBe(100);
    for (const backOpacity of [-5, 105, 33, '50']) expect(parseSubtitleStyle({ backOpacity }).backOpacity).toBe(70);
  });

  it('accepts colours only as #rrggbb', () => {
    expect(parseSubtitleStyle({ backColor: '#0b2545', outlineColor: '#FFFFFF' })).toMatchObject({ backColor: '#0b2545', outlineColor: '#FFFFFF' });
    for (const bad of ['#fff', 'navy', '#0b2545ff', 'url(x)', '#0b2545;', 0]) {
      expect(parseSubtitleStyle({ backColor: bad, outlineColor: bad })).toMatchObject({ backColor: '#000000', outlineColor: '#000000' });
    }
  });
});

describe('subtitle preview colours', () => {
  it('turns a colour and an opacity into CSS', () => {
    expect(rgba('#ffe14d', 100)).toBe('rgba(255, 225, 77, 1)');
    expect(rgba('#000000', 70)).toBe('rgba(0, 0, 0, 0.7)');
  });
});
