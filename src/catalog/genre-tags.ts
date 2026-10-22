/**
 * Genres as addons write them, normalised to a few tags, so "Sci-Fi",
 * "Science Fiction" and "Sci-Fi & Fantasy" match alike. Shared by Home's
 * mood rows and Tonight. Free text from addons: anything else has no tag.
 */

export type GenreTag = 'scifi' | 'mystery' | 'thriller' | 'horror' | 'comedy' | 'family' | 'animation' | 'war' | 'action' | 'romance';

const TAGS: [RegExp, GenreTag][] = [
  [/sci-?fi|science.?fiction/, 'scifi'],
  [/myster/, 'mystery'],
  [/thriller|suspense/, 'thriller'],
  [/horror/, 'horror'],
  [/comedy|sitcom/, 'comedy'],
  [/family|kids|children/, 'family'],
  [/animat|cartoon/, 'animation'],
  [/\bwar\b/, 'war'],
  [/\baction\b/, 'action'],
  [/romance|romantic/, 'romance'],
];

export function genreTags(genres: readonly string[]): Set<GenreTag> {
  const tags = new Set<GenreTag>();
  for (const genre of genres) {
    const name = genre.toLowerCase();
    for (const [pattern, tag] of TAGS) if (pattern.test(name)) tags.add(tag);
  }
  return tags;
}
