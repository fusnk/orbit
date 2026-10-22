import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Turkish strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Göz at',
  'remote.phone.browse-loading': 'Ana sayfan yükleniyor…',
  'remote.phone.browse-empty': 'Henüz gösterecek bir şey yok. Ana sayfayı doldurmak için Orbit’te bir katalog eklentisi ekle.',
  'remote.phone.browse-failed': 'Ana sayfan yüklenemedi. Tekrar dene.',
  'remote.phone.refresh': 'Yenile',
  'remote.phone.moods': 'Canın ne izlemek istiyor?',
  'remote.phone.mood-loading': 'Öneriler aranıyor…',
  'remote.phone.mood-empty': 'Şu an bu ruh haline uygun öneri yok.',
  'remote.phone.surprise': 'Beni şaşırt',
  'remote.phone.surprise-hint': 'Kataloglarından rastgele bir öneri.',
  'remote.phone.surprise-movie': 'Bir film',
  'remote.phone.surprise-series': 'Bir dizi',
  'remote.phone.surprise-none': 'Şu an önerecek yeni bir şey yok. Diğer türü dene ya da Orbit’te Beni şaşırt seçimlerini değiştir.',
  'remote.phone.details-loading': 'Ayrıntılar yükleniyor…',
  'remote.phone.details-failed': 'Bu yapım yüklenemedi. Tekrar dene.',
  'remote.phone.add-library': 'Kitaplığa ekle',
  'remote.phone.in-library': 'Kitaplığında',
  'remote.phone.close': 'Kapat',
  'remote.phone.season': '{number}. sezon',
  'remote.phone.specials': 'Özel bölümler',
  'remote.phone.episodes': 'Bölümler',
  'remote.phone.rating': 'IMDb puanı {rating}',
};
