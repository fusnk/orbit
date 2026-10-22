import { describe, expect, it } from 'vitest';
import { autoSyncCandidate, errorMessage, resultMessage, stageText, type SyncResult } from './subtitle-sync';
import type { TrackInfo } from './tracks';

const sub = (id: number, external: boolean, selected = false): TrackInfo => ({ id, kind: 'sub', title: null, lang: 'en', codec: 'subrip', channels: null, selected, secondary: false, external, default: false, forced: false });
const result = (patch: Partial<SyncResult>): SyncResult => ({ shift: 1.4, reference: 'subtitle', framerate: false, split: false, track: 7, ...patch });

describe('subtitle sync', () => {
  it('describes what moved', () => {
    expect(resultMessage(result({}))).toBe('Shifted by +1.4 s');
    expect(resultMessage(result({ shift: -0.04 }))).toBe('Shifted by 0.0 s');
    expect(resultMessage(result({ shift: -2.26, split: true }))).toBe('Shifted by −2.3 s · adjusted in parts');
    expect(resultMessage(result({ framerate: true, split: true }))).toBe('Shifted by +1.4 s · frame rate corrected');
    expect(resultMessage(result({ track: null, shift: 0 }))).toBe('Already in sync with the video');
  });

  it('turns Rust’s error codes into messages, and stays quiet when cancelled', () => {
    expect(errorMessage('no-reference')).toContain('Couldn’t find anything correctly timed');
    expect(errorMessage('uncertain')).toContain('reliable match');
    expect(errorMessage('cancelled')).toBeNull();
    // Anything unexpected (a crash, an unknown code) gets the general message.
    expect(errorMessage('something else')).toBe(errorMessage(new Error('x')));
    expect(errorMessage(undefined)).toContain('Syncing didn’t work');
  });

  it('shows each step, with progress while listening', () => {
    expect(stageText('reading', null)).toBe('Reading the video’s own subtitles…');
    expect(stageText('listening', 0.456)).toBe('Listening to the soundtrack… 46%');
    expect(stageText('listening', null)).toBe('Listening to the soundtrack…');
    expect(stageText('aligning', null)).toBe('Lining up the lines…');
  });

  it('syncs by itself only an added subtitle that’s showing and not yet tried', () => {
    expect(autoSyncCandidate([sub(1, false, true), sub(2, true)], new Set())).toBeNull();
    expect(autoSyncCandidate([sub(1, false), sub(2, true, true)], new Set())).toBe(2);
    expect(autoSyncCandidate([sub(2, true, true)], new Set([2]))).toBeNull();
    expect(autoSyncCandidate([{ ...sub(3, true, true), kind: 'audio' }], new Set())).toBeNull();
    expect(autoSyncCandidate([], new Set())).toBeNull();
  });
});
