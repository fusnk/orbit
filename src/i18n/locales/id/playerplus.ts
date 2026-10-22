import type { playerplus as source } from '../en/playerplus';
import type { Catalog } from '../types';

export const playerplus: Catalog<typeof source> = {
  // Settings hub
  'playerplus.hub.title': 'Pengaturan',
  'playerplus.hub.back': 'Kembali ke {to}',
  'playerplus.hub.picture': 'Kualitas & gambar',
  'playerplus.hub.sound': 'Suara',
  'playerplus.hub.speed-note': 'Tahan {key} untuk memutar dengan kecepatan 2× selama Anda menahannya.',
  'playerplus.hub.no-audio': 'Belum ada trek audio. Trek muncul setelah video dimuat.',
  'playerplus.hub.timing-sub': 'Subtitle {delay}',
  'playerplus.hub.timing-audio': 'Audio {delay}',
  'playerplus.hub.timing-none': 'Tidak disesuaikan',

  // Subtitle timing by what you noticed
  'playerplus.timing.heard-first': 'Terdengar duluan',
  'playerplus.timing.heard-first-hint': 'Subtitle terlambat: tampilkan lebih awal',
  'playerplus.timing.saw-first': 'Terlihat duluan',
  'playerplus.timing.saw-first-hint': 'Subtitle terlalu cepat: tampilkan lebih lambat',
  'playerplus.timing.earlier-by': 'Tampilkan subtitle {value} dtk lebih awal',
  'playerplus.timing.later-by': 'Tampilkan subtitle {value} dtk lebih lambat',

  // Sound
  'playerplus.sound.off': 'Asli',
  'playerplus.sound.off-hint': 'Suara seperti saat di-mix aslinya.',
  'playerplus.sound.cinema': 'Bioskop',
  'playerplus.sound.cinema-hint': 'Nada rendah lebih penuh dan sedikit lebih lapang, untuk film dengan volume yang cukup.',
  'playerplus.sound.music': 'Musik',
  'playerplus.sound.music-hint': 'Bass lebih hangat dan nada tinggi lebih cerah, untuk konser dan film musikal.',
  'playerplus.sound.dialogue': 'Dialog jelas',
  'playerplus.sound.dialogue-hint': 'Suara percakapan ditonjolkan di atas musik dan efek.',
  'playerplus.sound.note': 'Satu per satu. Diingat untuk setiap video.',

  // Live source search
  'playerplus.search.label': 'Mencari sumber untuk {name}',
  'playerplus.search.finding': 'Mencari add-on…',
  'playerplus.search.asking': 'Menghubungi…',
  'playerplus.search.sources.one': '{count} sumber',
  'playerplus.search.sources.other': '{count} sumber',
  'playerplus.search.none': 'Tidak ada hasil',
  'playerplus.search.failed': 'Tidak merespons',
  'playerplus.search.progress.one': '{count} dari {total} add-on merespons · {found} sumber sejauh ini',
  'playerplus.search.progress.other': '{count} dari {total} add-on merespons · {found} sumber sejauh ini',

  // Time readout
  'playerplus.time.finish': 'Sisa {left} · Selesai pukul {time}',

  // Seek bar bands
  'playerplus.bands.at': '{time} · {part}',
  'playerplus.bands.intro': 'Intro',
  'playerplus.bands.recap': 'Rekap',
  'playerplus.bands.credits': 'Kredit',
  'playerplus.bands.preview': 'Cuplikan',

  // Skipping
  'playerplus.skip.preview': 'Lewati cuplikan',
  'playerplus.skip.skipped-credits': 'Kredit dilewati',
  'playerplus.skip.skipped-preview': 'Cuplikan dilewati',

  // Jump bubble
  'playerplus.bubble.ahead': '+{seconds} dtk',
  'playerplus.bubble.back': '−{seconds} dtk',

  // Shortcut list
  'playerplus.cheat.action': 'Tampilkan pintasan pemutar',
  'playerplus.cheat.title': 'Pintasan pemutar',
  'playerplus.cheat.playback': 'Pemutaran',
  'playerplus.cheat.sound': 'Suara & subtitle',
  'playerplus.cheat.window': 'Gambar & jendela',
  'playerplus.cheat.fixed': 'Selalu',
  'playerplus.cheat.no-key': 'Tanpa tombol',
  'playerplus.cheat.hold': 'Tahan {key}',
  'playerplus.keys.number-jump': 'Lompat ke 0–90% video',
  'playerplus.keys.number-jump-keys': '0 – 9',
  'playerplus.keys.hold-boost': 'Putar 2× selama ditahan',
  'playerplus.keys.hold-boost-keys': 'Tahan {key}',

  // Lock
  'playerplus.lock.action': 'Kunci kontrol',
  'playerplus.lock.unlock': 'Buka kunci',
  'playerplus.lock.hint': 'Kontrol terkunci. Tekan Esc tiga kali untuk membuka kunci.',
  'playerplus.lock.hint-key': 'Kontrol terkunci. Tekan {key}, atau Esc tiga kali, untuk membuka kunci.',
  'playerplus.lock.unlocked': 'Kunci kontrol dibuka',

  // Docked episodes
  'playerplus.dock.collapse': 'Sembunyikan episode',
  'playerplus.dock.expand': 'Tampilkan episode',
  'playerplus.dock.number': 'E{number}',

  // Settings → Player and Playback
  'playerplus.settings.hold-boost': 'Tahan untuk kecepatan 2×',
  'playerplus.settings.hold-boost-hint': 'Menahan tombol putar/jeda memutar dengan kecepatan ganda sampai Anda melepasnya. Ketukan biasa tetap menjeda.',
  'playerplus.settings.number-jump': 'Lompat dengan tombol angka',
  'playerplus.settings.number-jump-hint': '1 melompat ke 10% video, 5 ke pertengahan, 0 ke awal. Tombol yang sudah Anda beri pintasan lain tetap mempertahankannya.',
  'playerplus.settings.grayscale': 'Hitam putih saat dijeda',
  'playerplus.settings.grayscale-hint': 'Gambar yang dijeda memudar menjadi abu-abu; warnanya kembali saat diputar.',
  'playerplus.settings.episodes': 'Daftar episode',
  'playerplus.settings.episodes-hint': 'Mengambang terbuka di atas kontrol. Tersemat menampilkan daftar di kanan yang dapat dilipat menjadi tab kecil.',
  'playerplus.settings.episodes-floating': 'Mengambang',
  'playerplus.settings.episodes-docked': 'Tersemat',
  'playerplus.settings.skipping': 'Melewati',
  'playerplus.settings.skipping-hint': 'Tombol menampilkan Lewati selama bagian itu diputar; Otomatis melewatinya tanpa bertanya (sekali: mundur ke bagian itu untuk menontonnya).',
  'playerplus.settings.skip-intro': 'Intro',
  'playerplus.settings.skip-recap': 'Rekap',
  'playerplus.settings.skip-credits': 'Kredit penutup',
  'playerplus.settings.skip-preview': 'Cuplikan setelah kredit',
  'playerplus.settings.skip-off': 'Nonaktif',
  'playerplus.settings.skip-button': 'Tombol',
  'playerplus.settings.skip-auto': 'Otomatis',
  'playerplus.settings.learn-skips': 'Pelajari kapan saya melewati intro',
  'playerplus.settings.learn-skips-hint': 'Lewati intro secara manual di sebuah serial, dan episode berikutnya akan menawarkan Lewati intro pada waktu yang sama, jika tidak ada waktu lewati lain yang diketahui. Disimpan di perangkat ini, untuk profil ini.',
  'playerplus.settings.forget-skips': 'Waktu intro yang dipelajari',
  'playerplus.settings.forget-skips-hint': 'Melupakan waktu intro yang dipelajari untuk setiap serial di profil ini.',
  'playerplus.settings.forget-skips-action': 'Lupakan',
  'playerplus.settings.forget-skips-done': 'Waktu intro yang dipelajari telah dilupakan',
};
