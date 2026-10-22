import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Settings → Appearance → Title page.
  'showcase.setting.label': 'Halaman judul',
  'showcase.setting.hint': 'Klasik menyimpan gambar dalam kartu. Showcase membentangkannya di seluruh jendela, dengan detail di bagian-bagian di bawahnya.',
  'showcase.setting.classic': 'Klasik',
  'showcase.setting.showcase': 'Showcase',
  // The hero.
  'showcase.start-episode': 'Mulai S{season} · E{episode}',
  'showcase.ends-at': 'Selesai pukul {time}',
  'showcase.ends-at-hint': 'Waktu selesai jika Anda mulai sekarang',
  'showcase.age-rating': 'Rating usia {rating}',
  'showcase.streaming-on': 'Tayang di {provider}',
  // Episodes.
  'showcase.choose-season': 'Musim',
  'showcase.choose-arc': 'Alur cerita',
  'showcase.episode-count.one': '{count} episode',
  'showcase.episode-count.other': '{count} episode',
  'showcase.episode-length': '{number} · {minutes} mnt',
  'showcase.season-actions': 'Tindakan musim',
  'showcase.download-season.one': 'Unduh musim ({count} episode)',
  'showcase.download-season.other': 'Unduh musim ({count} episode)',
  // Sections.
  'showcase.extras': 'Trailer & Ekstra',
  'showcase.cast-crew': 'Pemeran & Kru',
  'showcase.photos': 'Foto',
  'showcase.stills': 'Cuplikan Adegan',
  'showcase.topics': 'Topik',
  'showcase.topic-intro': 'Film dan serial yang ditandai TMDB dengan “{topic}”.',
  'showcase.where-to-watch': 'Tempat Menonton',
  'showcase.stream': 'Streaming',
  'showcase.rent': 'Sewa',
  'showcase.buy': 'Beli',
  'showcase.justwatch': 'Data dari JustWatch',
  'showcase.releases': 'Tanggal rilis',
  'showcase.cinemas-only': 'Sejauh ini baru tayang di bioskop — salinan awal biasanya rekaman bioskop.',
};
