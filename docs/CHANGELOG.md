# Changelog

Bu dosya, KoUp platformunda yapılan tüm önemli geliştirmeleri, mimari kararları, hata düzeltmelerini, güvenlik iyileştirmelerini ve dokümantasyon güncellemelerini [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatında listeler.

### Sürüm ve Değişiklik Türleri
- **Added:** Sisteme eklenen yeni özellikler, sayfalar, bileşenler, scriptler veya tablolar.
- **Changed:** Mevcut işlevlerde yapılan mimari, UI veya davranış değişiklikleri.
- **Fixed:** Düzeltilen hatalar, kırık video akışları veya mantıksal problemler.
- **Security:** Güvenlik açığı düzeltmeleri, RLS politikaları, advisor onarımları ve yetki kontrolleri.
- **Performance:** Hız optimizasyonları, önbellek iyileştirmeleri ve Core Web Vitals kazanımları.

---

## [2026-10-27] — Video Oynatıcı İntro Atlama ve Z-Index Katmanlama Onarımı

### Fixed
- `NetflixPlayer.tsx`: Otomatik intro atlama açıkken decoder hazır olmadan mount anında tetiklenip kilitlenen `autoSkippedIntroEpRef` yarış durumu giderildi. `handleLoadedMetadata`, HLS `MANIFEST_PARSED` ve `onTimeUpdate` döngüsünde güvenli atlama tetikleyicisi kuruldu; introlar güvenle `intro_end_sec + 0.5` saniyesine atlatıldı. Bölüm değişiminde ve intro öncesine geri sarmada atlama referansı sıfırlandı.
- `NetflixPlayer.tsx`: Yüzen "İntroyu Atla" butonunun yanındaki kalabalık oluşturan yeşil "Otomatik: Açık" rozeti kaldırıldı; ayarın Oynatma Tercihleri menüsünden yönetilmesi sağlandı.
- `NetflixPlayer.tsx`: Ayarlar ("Oynatma Tercihleri"), Kalite, Hız ve Bölümler açılır menüleri `z-[60]` seviyesine taşındı. Menü açıkken `netflix-hud-layer` katmanı `z-50` seviyesine yükseltildi, sağ alttaki yüzen aksiyon katmanı `z-20` seviyesine alınıp gizlenerek menülerin altında kalması veya tıklamaları engellemesi engellendi.

### Changed
- `docs/05-oynatici-ve-yayin-akisi.md`: İntro ve outro atlama mantığı ile z-index katmanlama hiyerarşisi dokümantasyonu güncellendi.

---

## [2026-10-27] — Admin Scraper Otomasyonu 20+ Siteye Genişletildi

### Changed
- `koup-app/src/app/admin/page.tsx` & `koup-app/src/app/api/admin/automation/route.ts`: Sabit 8 site kısıtlaması (`ACTIVE_SCRAPER_IDS`) kaldırılarak Supabase'deki tüm aktif 20 scraper botu (`diziizle`, `shortizle`, `dramavadisi`, `webdramaturkey2`, `dramabox`, `animelvl`, `sezonlukdizi`, `dizipal` vb.) panele açıldı.
- `koup-app/src/components/AdminAutomationCenter.tsx`: 20 bot için marka bilgileri (`anizm`, `asyamag` dahil) eklendi ve bot ızgarası 3'lü kompakt sütuna uyarlandı.
- `scripts/series_automation_runner.py`: `SUPPORTED_SITES` listesi 22 siteye genişletildi ve tüm sitelerin scraper router fonksiyonları bağlandı.
- `scripts/live_multi_search.py`: Diziİzle ve Shortİzle canlı arama entegrasyonu sağlandı.


### Changed
- `koup-app/src/components/AdminSeriesAutomation.tsx`: Kart düzeni 2 seviyeli hiyerarşiye dönüştürüldü; poster, başlık ve istatistiklerin tek satırda dar sütuna sıkışması engellendi. Bağlı olmayan kaynak siteleri akordeon açılır tepsisine taşındı. `slugifyTR` ile Türkçe karakter destekli slug üretimi sağlandı.
- `koup-app/src/components/admin/AdminMaintenanceHub.tsx`: Eksik Bölüm Onarıcı ve Bekleyen Kaynak Çözücü kartlarındaki kör ID girdi kutuları kaldırılıp `AdminMediaPicker` entegre edildi.
- `koup-app/src/components/admin/AdminSeriesRequests.tsx`: Topluluk isteklerini onaylarken istenen serbest metin slug alanı yerine afişli `AdminMediaPicker` entegre edildi; talep edilen dizi adıyla otomatik hızlı arama önerisi sunuldu.

---

## [2026-10-27] — KoUp Kapsamlı Dokümantasyon Sistemi & Yaşayan Dokümantasyon Standardı

### Added
- `docs/README.md`: KoUp dokümantasyon portalı ana dizini, 3 katmanlı mimari özeti, hızlı çözüm fihristi, yeni geliştirici okuma sırası ve tüm teknik dosyaların içindekiler tablosu.
- `docs/01-genel-bakis-ve-mimari.md`: Platform vizyonu, teknoloji yığını, frontend ⇄ edge ⇄ veritabanı akış diyagramları.
- `docs/02-kurulum-ortam-ve-deploy.md`: Yerel kurulum adımları, ortam değişkenleri fihristi ve Vercel/Cloudflare dağıtım yönergeleri.
- `docs/03-sayfalar-ve-rotalar.md`: 26+ Next.js App Router sayfasının tam mimari analizi.
- `docs/04-bilesenler-ve-tasarim-sistemi.md`: Lumina OLED tasarım dili, `CustomSelect.tsx`, `AccordionMediaCard.tsx` ve mobil bileşen mimarisi.
- `docs/05-oynatici-ve-yayin-akisi.md`: `NetflixPlayer.tsx` çift katmanlı oynatıcı, HLS/MP4 akış motoru, proxy ve fallback zinciri.
- `docs/06-api-referansi.md`: 39+ REST API uç noktasının parametre, auth, rate limit ve yanıt şemaları.
- `docs/07-kimlik-yetki-ve-guvenlik.md`: Supabase Auth, `adminAuth.ts`, fingerprint & hard ban, SSRF/XSS korumaları ve CSP başlıkları.
- `docs/08-veri-katmani.md`: 27+ PostgreSQL tablosu, SQLite şeması, R2 JSON paketleme ve kota optimizasyonları.
- `docs/09-kaziyicilar-scriptler-ve-senkron.md`: 9 kaynak tarama motoru, 64 Python scripti ve 3 halkalı tam arşiv senkronizasyon zinciri.
- `docs/10-kullanici-ozellikleri.md`: İzleme geçmişi (`progressSync`), listeler, bildirimler, zengin yorumlar ve AsyaMag.
- `docs/11-state-hooklar-ve-kutuphaneler.md`: `KoUpContext.tsx`, özel hook'lar (`usePillDragTracking`, `useDragScroll`) ve `src/lib/` yardımcıları.
- `docs/12-kurallar-ve-yasaklar.md`: 24 temel kural ve yasak (`<select>` yasağı, sıfır hardcoded secrets, CWV, 4 kademeli mobil benchmark, no fake success).
- `docs/13-sss.md`: 9 kategoride toplanmış 45+ teknik soru ve doğrulanmış çözüm adımları.
- `docs/14-dokumantasyon-rehberi.md`: Hangi kod değişikliğinde hangi dokümanın güncelleneceğini gösteren eşleme tablosu ve yeni özellik şablonu.
- `scripts/heal_short_drama_posters.py`: DramaVadisi Cloudflare WAF engelini aşmak için 2.990 kısa drama afişini doğrudan Cloudflare R2'ye aktarıp SQLite, Supabase ve R2 zincirini senkronize eden çok iş parçacıklı iyileştirme aracı.

### Changed
- `GEMINI.md`: §12 Yaşayan Dokümantasyon (Living Documentation) kuralı eklendi — yeni özellik eklendiğinde doküman yazımı ve değişikliklerde doküman güncellemesi zorunlu kılındı.
- `koup-app/src/components/shorts/ShortsCard.tsx`: Kart üzerine gelindiğinde/focus anında çıkan turuncu daire play butonu kaldırıldı, temiz afiş ölçekleme animasyonu korundu.
- `koup-app/src/components/NetflixPlayer.tsx`: Dikey 9:16 mod (`variant === 'vertical'`) için kontroller yeniden ölçeklendirildi. İç kısımdaki gereksiz "Bölümler" ve "Sonraki Bölüm" butonları dikey modda gizlendi, buton ve boşluk boyutları taşmayı önleyecek şekilde kompaktlaştırıldı.
- `koup-app/src/app/api/resolve-stream/route.ts`: Shortİzle mbdp/signed akışları için Cookie jar, `X-Requested-With` başlığı, doğrudan m3u8 fallback'leri eklendi. Vidmoly `embed-embed.html-` URL normalizasyonu eklendi.
- `koup-app/src/app/api/stream-proxy/route.ts`: Bunny CDN (`b-cdn.net`) ve MyBigDramaPool alan adları için `shortizle.com` Referer/Origin desteği eklendi. `.dts` segment parçaları için `video/mp2t` içerik türü tanımlandı.
- `scrapers/stream_resolver.py`: Shortİzle stream resolver oturum ve fallback mimarisi güçlendirildi.
- `webdrama_archive.db`: 15.120 bozuk Vidmoly URL'si düzeltildi; 2.990 kısa drama kaydı R2 CDN afiş URL'leriyle güncellendi ve R2'ye yedeklendi.

### Security
- `koup-app/src/app/api/stream-proxy/route.ts`: Özel IP aralıkları (10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, 127.0.0.0/8) ve DNS çözümlemesi ile SSRF açığı engellendi.
- `koup-app/src/app/api/image-proxy/route.ts`: SVG dosyaları için `Content-Security-Policy: default-src 'none'; sandbox` başlığı tanımlanarak SVG tabanlı XSS atakları engellendi.
- `koup-app/src/lib/adminAuth.ts`: Host veya Referer sahtelemesine karşı katı ortam kontrolleri eklendi; `ADMIN_DEV_BYPASS=1` yalnızca yerel geliştirme için sınırlandırıldı.
