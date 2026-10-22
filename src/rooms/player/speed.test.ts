import { describe, expect, it } from 'vitest';
import { CUSTOM_MAX, CUSTOM_MIN, isPreset, presetStep, speedLabel, stepSpeed } from './speed';

describe('speed steps', () => {
  it('moves 0.05× at a time', () => {
    expect(stepSpeed(1, 1)).toBe(1.05);
    expect(stepSpeed(1, -1)).toBe(0.95);
    expect(stepSpeed(1.35, 1)).toBe(1.4);
    expect(stepSpeed(0.3, -1)).toBe(0.25);
  });

  it('stays within 0.25–3×', () => {
    expect(stepSpeed(CUSTOM_MIN, -1)).toBe(CUSTOM_MIN);
    expect(stepSpeed(CUSTOM_MAX, 1)).toBe(CUSTOM_MAX);
    expect(stepSpeed(4, -1)).toBe(CUSTOM_MAX);
  });

  it('lands on the grid from a speed off it', () => {
    expect(stepSpeed(1.33, 1)).toBe(1.35);
    expect(stepSpeed(1.33, -1)).toBe(1.3);
  });

  it('copes with mpv’s floating point', () => {
    expect(stepSpeed(1.1500000001, 1)).toBe(1.2);
    expect(speedLabel(1.3500000001)).toBe('1.35×');
  });

  it('knows the pills', () => {
    expect(isPreset(1.25)).toBe(true);
    expect(isPreset(1.75)).toBe(false);
    expect(isPreset(1.0000001)).toBe(true);
  });
});

describe('speed keys', () => {
  it('step through the pills', () => {
    expect(presetStep(1, 1)).toBe(1.25);
    expect(presetStep(1, -1)).toBe(0.75);
    expect(presetStep(1.0000001, 1)).toBe(1.25);
  });

  it('go to the nearest pill from a speed between them', () => {
    expect(presetStep(1.35, 1)).toBe(1.5);
    expect(presetStep(1.35, -1)).toBe(1.25);
  });

  it('stay put at either end', () => {
    expect(presetStep(2, 1)).toBe(2);
    expect(presetStep(0.5, -1)).toBe(0.5);
    expect(presetStep(3, 1)).toBe(3);
  });
});
