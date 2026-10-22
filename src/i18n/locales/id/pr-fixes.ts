import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Indonesian strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Perbarui pengaturan add-on ini?",
  'prfixes.addons.update-detail': "{name} sudah terpasang. Pengaturan ini menggantikan yang lama, dan posisinya di daftar Anda tetap.",
  'prfixes.addons.update': "Perbarui",
  'prfixes.audio.original': "Bahasa asli dulu",
  'prfixes.audio.original-hint': "Setiap film atau serial dimulai dalam bahasa aslinya jika videonya punya audio itu: anime dalam bahasa Jepang, drama Korea dalam bahasa Korea. Jika tidak, bahasa audio di atas. Memerlukan kunci TMDB.",
  'prfixes.bundle.local': "Alamat ini mengarah ke komputer ini atau jaringan rumah Anda, jadi Orbit tidak menghubunginya.",
};
