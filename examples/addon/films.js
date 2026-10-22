// Every film here is public domain or Creative Commons licensed, hosted by the
// Internet Archive or the Blender Foundation. CC BY films are credited in
// their descriptions, as the license requires.

const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${file}`;
const archiveThumb = (id) => `https://archive.org/services/img/${id}`;

export const films = [
  {
    id: 'orbitpd:big-buck-bunny',
    name: 'Big Buck Bunny',
    releaseInfo: '2008',
    genres: ['Animation', 'Comedy'],
    runtime: '10 min',
    poster: commons('Big_buck_bunny_poster_big.jpg'),
    description:
      'A giant rabbit takes revenge on three bullying rodents. © Blender Foundation, licensed CC BY 3.0 (peach.blender.org).',
    stream: {
      url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
      quality: '720p',
    },
  },
  {
    id: 'orbitpd:elephants-dream',
    name: 'Elephants Dream',
    releaseInfo: '2006',
    genres: ['Animation', 'Sci-Fi'],
    runtime: '11 min',
    poster: commons('Elephants_Dream_s5_both.jpg'),
    description:
      'Two men explore a strange, ever-shifting machine. © Blender Foundation / Netherlands Media Art Institute, licensed CC BY 2.5 (orange.blender.org).',
    stream: { url: 'https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov', quality: '720p' },
  },
  {
    id: 'orbitpd:sintel',
    name: 'Sintel',
    releaseInfo: '2010',
    genres: ['Animation', 'Fantasy'],
    runtime: '15 min',
    poster: commons('Sintel_poster.jpg'),
    description:
      'A young woman searches for the baby dragon she once rescued. © Blender Foundation, licensed CC BY 3.0 (durian.blender.org).',
    stream: { url: 'https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv', quality: '1080p' },
    // A second source, so switching sources can be tested.
    alternates: [{ url: 'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4', quality: '480p', host: 'Internet Archive' }],
  },
  {
    id: 'orbitpd:tears-of-steel',
    name: 'Tears of Steel',
    releaseInfo: '2012',
    genres: ['Sci-Fi', 'Action'],
    runtime: '12 min',
    poster: commons('Tos-poster.png'),
    description:
      'Scientists in a future Amsterdam try to save the world from robots. © Blender Foundation, licensed CC BY 3.0 (mango.blender.org).',
    stream: { url: 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov', quality: '720p' },
  },
  {
    id: 'orbitpd:the-general',
    name: 'The General',
    releaseInfo: '1926',
    genres: ['Comedy', 'Action'],
    runtime: '78 min',
    poster: archiveThumb('TheGeneral_201312'),
    description: 'Buster Keaton chases his stolen locomotive across Civil War lines. Public domain.',
    stream: { url: 'https://archive.org/download/TheGeneral_201312/The-General-v2.mp4', quality: '480p' },
  },
  {
    id: 'orbitpd:his-girl-friday',
    name: 'His Girl Friday',
    releaseInfo: '1940',
    genres: ['Comedy'],
    runtime: '92 min',
    poster: archiveThumb('his_girl_friday'),
    description: 'A newspaper editor schemes to win back his ex-wife and star reporter. Public domain.',
    stream: { url: 'https://archive.org/download/his_girl_friday/his_girl_friday_512kb.mp4', quality: 'SD' },
  },
  {
    id: 'orbitpd:night-of-the-living-dead',
    name: 'Night of the Living Dead',
    releaseInfo: '1968',
    genres: ['Horror'],
    runtime: '96 min',
    poster: archiveThumb('night_of_the_living_dead_dvd'),
    description: 'Strangers barricade themselves in a farmhouse against the undead. Public domain.',
    stream: { url: 'https://archive.org/download/night_of_the_living_dead_dvd/Night.mp4', quality: 'SD' },
  },
];
