import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  'jellyfin.settings.intro': "Kendi Jellyfin sunucundan oynat. Sunucudaki filmler ve bölümler bir Jellyfin kaynağı kazanır, satırları da Ana Sayfa’ya eklenebilir. Orbit sunucudan bir oturum belirteci saklar, şifreni asla.",
  'jellyfin.settings.server': "Sunucu adresi",
  'jellyfin.settings.server-placeholder': "http://192.168.1.10:8096",
  'jellyfin.settings.username': "Kullanıcı adı",
  'jellyfin.settings.password': "Şifre",
  'jellyfin.settings.fields-hint': "Jellyfin’i tarayıcıda açtığın adres. Jellyfin 10.9 veya daha yenisi gerekir.",
  'jellyfin.settings.connect': "Bağlan",
  'jellyfin.settings.connecting': "Bağlanıyor…",
  'jellyfin.settings.server-label': "Sunucu",
  'jellyfin.settings.connected-as': "Kullanıcı: {user} · Sunucu: {server}",
  'jellyfin.settings.connected': "Bağlandı: {server}.",
  'jellyfin.settings.connected-first': "Bağlandı: {server}. “Son eklenenler” artık Ana Sayfa’da; daha fazla Jellyfin satırını Ayarlar → Ana Sayfa ve Kitaplık → Ana Sayfa satırları bölümünden ekle.",
  'jellyfin.settings.disconnect': "Bağlantıyı kes",
  'jellyfin.settings.disconnected': "Bağlantı kesildi ve sunucudan çıkış yapıldı.",
  'jellyfin.settings.insecure': "Güvenli değil",
  'jellyfin.settings.insecure-title': "Bu sunucu düz http kullanıyor, bu yüzden oturum bilgilerin ve videoların şifrelenmeden iletilir. Evde sorun değil; internet üzerinden https kullan.",
  'jellyfin.rows.kind': "Jellyfin",
  'jellyfin.rows.resume': "İzlemeye devam et",
  'jellyfin.rows.latest': "Son eklenenler",
  'jellyfin.rows.label': "Jellyfin: {row}",
  'jellyfin.rows.not-connected': "Önce Ayarlar → Hesaplar ve Hizmetler bölümünden bir Jellyfin sunucusuna bağlan.",
  'jellyfin.rows.libraries-failed': "Sunucunun kitaplıkları yüklenemedi.",
  'jellyfin.source.origin': "Jellyfin · {server}",
};
