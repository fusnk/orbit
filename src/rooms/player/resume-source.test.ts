import { describe, expect, it } from 'vitest';
import type { LastSource } from './last-source';
import { decideResume, lastSourceLine, parseResumeSourceMode } from './last-source';

const last: LastSource = { where: 'tt1/', digest: 'abc', name: '', addon: 'Addon D', label: '1080p', meta: '4.2 GB', filename: '', at: 1 };

describe('when resuming', () => {
  it('asks only when the last source is known; otherwise Play works as before', () => {
    expect(decideResume('ask', last)).toBe('ask');
    expect(decideResume('ask', undefined)).toBeUndefined();
    expect(decideResume('last', undefined)).toBeUndefined();
  });

  it('follows a fixed choice', () => {
    expect(decideResume('last', last)).toEqual({ kind: 'last', last });
    expect(decideResume('choose', undefined)).toEqual({ kind: 'choose' });
    expect(decideResume('best', last)).toEqual({ kind: 'best' });
  });

  it('reads the setting, Ask by default', () => {
    for (const mode of ['ask', 'last', 'choose', 'best'] as const) expect(parseResumeSourceMode(mode)).toBe(mode);
    for (const junk of [null, undefined, 'Last', 1, {}]) expect(parseResumeSourceMode(junk)).toBe('ask');
  });

  it('describes the last source by addon, quality and release only', () => {
    expect(lastSourceLine(last)).toBe('Addon D · 1080p · 4.2 GB');
  });
});
