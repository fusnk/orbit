import { describe, expect, it } from 'vitest';
import { shownGroups } from './panels';
import type { SubtitleGroup } from './tracks';

const group = (name: string): SubtitleGroup => ({ key: name.toLowerCase(), name, options: [], selected: false });
const many = ['Arabic', 'Czech', 'Dutch', 'English', 'French', 'German', 'Italian', 'Polish', 'Spanish'].map(group);

describe('the Subtitles view\'s language search', () => {
  it('narrows the languages while its field shows', () => {
    expect(shownGroups(many, 'fr').map((g) => g.name)).toEqual(['French']);
  });

  it('hides nothing once there are too few languages for the field to show (it could not be cleared)', () => {
    const few = many.slice(0, 3);
    expect(shownGroups(few, 'fr')).toEqual(few);
  });
});
