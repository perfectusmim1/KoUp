# KoUp Proje Dokümantasyonu (Living Documentation)

KoUp modern, yüksek performanslı, çok kaynaklı bir dizi, film, anime ve kısa drama (short drama) streaming platformudur.

## İçindekiler
1. [Mimarisi & Veri Akışı](#mimarisi--veri-akışı)
2. [Oynatıcı (Player) Mimarisi](#oynatıcı-player-mimarisi)
3. [Akış Çözücü & Proxy Katmanı](#akış-çözücü--proxy-katmanı)
4. [Kısa Drama (Shorts) ve CDN Dağıtımı](#kısa-drama-shorts-ve-cdn-dağıtımı)
5. [Arşiv & Full Storage Sync Zinciri](#arşiv--full-storage-sync-zinciri)
6. [Changelog](CHANGELOG.md)

---

## Mimarisi & Veri Akışı
- **Frontend:** Next.js 16 (App Router), Tailwind CSS v4, Lucide Icons, Hls.js, Shaka Player.
- **Backend / API:** Next.js Route Handlers (`/api/resolve-stream`, `/api/stream-proxy`, `/api/image-proxy`).
- **Veritabanı & Metadata:** Supabase PostgreSQL (`public.media`, `public.episodes`), yerel SQLite `webdrama_archive.db`.
- **Depolama & CDN:** Cloudflare R2 (`koup-archive` bucket), Cloudflare R2 Public CDN.

---

## Oynatıcı (Player) Mimarisi
- **Bileşen:** `koup-app/src/components/NetflixPlayer.tsx`
- **Varyantlar:**
  - `default`: Standart 16:9 yatay sinematik oynatıcı.
  - `vertical`: 9:16 dikey kısa drama oynatıcısı. Yan panelde veya mobil alt çekmecede bölüm seçimi bulunduğu için iç kısımdaki gereksiz "Bölümler" ve "Sonraki Bölüm" butonları gizlenir, kontrol çubuğu dikey kompakt ölçeklemeyle taşmayı engeller.
- **Özellikler:** Sinematik ortam ışıklandırması (ambient canvas), otomatik intro/outro atlama, hız kontrolü (0.25x - 2x), kalite seçimi, ses ve altyazı yönetimi, Google Cast (Chromecast) entegrasyonu.

---

## Akış Çözücü & Proxy Katmanı
- **API Uçları:**
  - `/api/resolve-stream`: Kaynak URL'lerini ve video sağlayıcılarını (Vidmoly, Shortİzle, Pichive, Dizipal vb.) arka planda çözüp doğrudan oynatılabilir HLS (.m3u8) veya MP4 formatına dönüştürür.
  - `/api/stream-proxy`: CORS, Referer ve Origin korumalarını aşarak HLS manifestlerini ve segment parçalarını istemciye güvenle aktarır. Bunny CDN (`.dts`), MyBigDramaPool, Pichive vb. segmentlerini dinamik olarak yeniden yazar.

---

## Kısa Drama (Shorts) ve CDN Dağıtımı
- **Bileşenler:** `ShortsRail.tsx`, `ShortsCard.tsx`
- **Görsel Dağıtımı:** Hedef sitelerden (DramaVadisi vb.) çekilen afişler harici IP bloklaması yaşamamak için Cloudflare R2 (`posters/shortdrama/{id}.webp`) üzerine kaydedilir ve R2 CDN üzerinden sunulur. Kart üzerinde gereksiz hover play butonları kaldırılmıştır.

---

## Arşiv & Full Storage Sync Zinciri
- **Scriptler:**
  - `scripts/heal_short_drama_posters.py`: Eksik afişleri tarar, R2'ye yükler, SQLite ve Supabase'i günceller.
  - `scrapers/supabase_sync_helper.py`: `backup_db_to_r2()`, Supabase `media`/`episodes` senkronizasyonu.
- **Kural:** Yerel SQLite veritabanında yapılan her değişiklikten sonra Supabase, Cloudflare R2 veritabanı yedeği ve R2 JSON paketleri eksiksiz eşitlenir.
