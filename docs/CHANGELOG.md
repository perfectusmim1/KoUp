# Changelog

Tüm önemli değişiklikler bu dosyada listelenir.

## [2026-10-27] - Shorts & Player Onarımları, REA Akış İyileştirmeleri ve Afiş CDN Eşitlemesi

### Added
- `scripts/heal_short_drama_posters.py`: DramaVadisi Cloudflare WAF engelini aşmak için 2.990 kısa drama afişini doğrudan Cloudflare R2'ye aktarıp SQLite, Supabase ve R2 zincirini senkronize eden çok iş parçacıklı iyileştirme aracı.

### Changed
- `koup-app/src/components/shorts/ShortsCard.tsx`: Kart üzerine gelindiğinde/focus anında çıkan turuncu daire play butonu kaldırıldı, temiz afiş ölçekleme animasyonu korundu.
- `koup-app/src/components/NetflixPlayer.tsx`: Dikey 9:16 mod (`variant === 'vertical'`) için kontroller yeniden ölçeklendirildi. İç kısımdaki gereksiz "Bölümler" ve "Sonraki Bölüm" butonları dikey modda gizlendi, buton ve boşluk boyutları taşmayı önleyecek şekilde kompaktlaştırıldı.
- `koup-app/src/app/api/resolve-stream/route.ts`: Shortİzle mbdp/signed akışları için Cookie jar, `X-Requested-With` başlığı, doğrudan m3u8 fallback'leri eklendi. Vidmoly `embed-embed.html-` URL normalizasyonu eklendi.
- `koup-app/src/app/api/stream-proxy/route.ts`: Bunny CDN (`b-cdn.net`) ve MyBigDramaPool alan adları için `shortizle.com` Referer/Origin desteği eklendi. `.dts` segment parçaları için `video/mp2t` içerik türü tanımlandı.
- `scrapers/stream_resolver.py`: Shortİzle stream resolver oturum ve fallback mimarisi güçlendirildi.
- `webdrama_archive.db`: 15.120 bozuk Vidmoly URL'si düzeltildi; 2.990 kısa drama kaydı R2 CDN afiş URL'leriyle güncellendi ve R2'ye yedeklendi.
