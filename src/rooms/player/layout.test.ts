import { describe, expect, it } from 'vitest';
import { choosePreset, DEFAULT_LAYOUT, languageBadges, layoutAttributes, parsePlayerLayout, PRESETS, withControlScale } from './layout';
import type { TrackInfo } from './tracks';

const track = (kind: 'audio' | 'sub', lang: string | null, selected: boolean, secondary = false): TrackInfo => ({
  id: 1,
  kind,
  title: null,
  lang,
  codec: null,
  channels: null,
  selected,
  secondary,
  external: false,
  default: false,
  forced: false,
});

describe('player layout', () => {
  it('Orbit with the defaults is today’s player', () => {
    expect(choosePreset({ ...DEFAULT_LAYOUT, clock: false }, 'orbit')).toEqual(DEFAULT_LAYOUT);
  });

  it('a preset sets its own options and keeps the clock', () => {
    const minimal = choosePreset({ ...DEFAULT_LAYOUT, clock: true }, 'minimal');
    expect(minimal).toMatchObject({ preset: 'minimal', title: false, next: false, clock: true });
    expect(choosePreset(minimal, 'compact').size).toBe('compact');
    for (const preset of PRESETS) expect(choosePreset(DEFAULT_LAYOUT, preset).preset).toBe(preset);
  });

  it('Theatre keeps the title, badges and next button, on an accent timeline', () => {
    expect(choosePreset({ ...DEFAULT_LAYOUT, clock: true }, 'theater')).toEqual({ ...DEFAULT_LAYOUT, preset: 'theater', timeline: 'accent', clock: true });
    expect(parsePlayerLayout({ ...DEFAULT_LAYOUT, preset: 'theater' }).preset).toBe('theater');
    expect(parsePlayerLayout({ ...DEFAULT_LAYOUT, preset: 'theatre' }).preset).toBe('orbit');
    expect(layoutAttributes(choosePreset(DEFAULT_LAYOUT, 'theater')).layout).toBe('theater');
  });

  it('Cinema: a thin line, no next button, title and badges kept', () => {
    expect(choosePreset({ ...DEFAULT_LAYOUT, clock: true }, 'cinema')).toEqual({ ...DEFAULT_LAYOUT, preset: 'cinema', next: false, clock: true });
    expect(parsePlayerLayout({ ...DEFAULT_LAYOUT, preset: 'cinema' }).preset).toBe('cinema');
    expect(layoutAttributes(choosePreset(DEFAULT_LAYOUT, 'cinema')).layout).toBe('cinema');
  });

  it('attributes: the Chapters timeline always shows its marks', () => {
    expect(layoutAttributes(DEFAULT_LAYOUT)).toEqual({ layout: 'orbit', size: 'standard', controlsBg: 'gradient', timeline: 'line', titleInfo: 'on', badges: 'on', nextButton: 'on', chapterMarks: 'on', clock: 'off' });
    expect(layoutAttributes({ ...DEFAULT_LAYOUT, chapters: false }).chapterMarks).toBe('off');
    expect(layoutAttributes({ ...DEFAULT_LAYOUT, chapters: false, timeline: 'chapters' }).chapterMarks).toBe('on');
  });

  it('language badges: the playing audio, then the main subtitles’ code', () => {
    expect(languageBadges([track('audio', 'eng', false), track('audio', 'fre', true), track('sub', 'en', true), track('sub', 'de', false, true)])).toEqual([expect.any(String), 'EN']);
    expect(languageBadges([track('audio', null, true), track('sub', 'es', false)])).toEqual([]);
    expect(languageBadges([track('sub', 'pt-BR', true)])).toEqual(['PT-BR']);
  });
});

describe('the in-player controls size', () => {
  it('saves a size’s own scale as that size, so Settings → Player shows it', () => {
    expect(withControlScale({ ...DEFAULT_LAYOUT, scale: 0.9 }, 1.2)).toEqual({ ...DEFAULT_LAYOUT, size: 'large' });
    expect(withControlScale(DEFAULT_LAYOUT, 0.85)).toEqual({ ...DEFAULT_LAYOUT, size: 'compact' });
    expect(withControlScale({ ...DEFAULT_LAYOUT, size: 'large' }, 1)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps any other scale as a custom one over the size', () => {
    expect(withControlScale({ ...DEFAULT_LAYOUT, size: 'large' }, 1.3)).toEqual({ ...DEFAULT_LAYOUT, size: 'large', scale: 1.3 });
  });
});
