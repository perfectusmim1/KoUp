# Changelog

Bu dosya, KoUp platformunda yapılan tüm önemli geliştirmeleri, mimari kararları, hata düzeltmelerini, güvenlik iyileştirmelerini ve dokümantasyon güncellemelerini [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatında listeler.

### Sürüm ve Değişiklik Türleri
- **Added:** Sisteme eklenen yeni özellikler, sayfalar, bileşenler, scriptler veya tablolar.
- **Changed:** Mevcut işlevlerde yapılan mimari, UI veya davranış değişiklikleri.
- **Fixed:** Düzeltilen hatalar, kırık video akışları veya mantıksal problemler.
- **Security:** Güvenlik açığı düzeltmeleri, RLS politikaları, advisor onarımları ve yetki kontrolleri.
- **Performance:** Hız optimizasyonları, önbellek iyileştirmeleri ve Core Web Vitals kazanımları.

---

## [2026-11-21] — Tam Arşiv Onarımı, Kısa Drama Dikey Oynatıcı, Güvenlik/Advisor Sertleştirme & 4 Kademeli Performans

### Fixed
- **Bildirim & Son Eklenenler Koruması:** [`scrapers/supabase_sync_helper.py`](../scrapers/supabase_sync_helper.py), [`scripts/sync_all_episodes_to_supabase.py`](../scripts/sync_all_episodes_to_supabase.py), [`api/admin/sync-series/route.ts`](../koup-app/src/app/api/admin/sync-series/route.ts), [`homeData.ts`](../koup-app/src/lib/server/homeData.ts), [`son-eklenenler/page.tsx`](../koup-app/src/app/son-eklenenler/page.tsx) ve [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) güncellendi; mevcut bölümlere kaynak eklendiğinde `"published_at": None` gönderilerek sahte bildirim ve ana sayfa sıçraması önlendi. `/son-eklenenler` sayfasında `count: 'estimated'` ve mobil filtre taşma/kırpılma onarımı uygulandı.
- **Kısa Drama, Oynatıcı & Arayüz Bütünlüğü:** [`NetflixPlayer.tsx`](../koup-app/src/components/NetflixPlayer.tsx) içinde tüm açılır menü ve mobil alt sayfalar (`#0d0e13/95` koyu cam, tek tip ikon/anahtar) ile hizalandı; dikey 9:16 oynatıcıda ses çubuğu yüzen hap içine alındı, kalite/hız/ayar popover'ları ilerleme çubuğunun üzerine yükseltildi ve yatay ayarlar/kalite panelleri sağa yaslandı (`right-0`). Çalışmayan/ölü kaynaklar dropdown, kaynak hapı ve hata ekranından gizlenip arka planda [`report-dead-source`](../koup-app/src/app/api/report-dead-source/route.ts) (`4000` karakter sınırı) üzerinden bildirilir hale getirildi. [`Navbar.tsx`](../koup-app/src/components/Navbar.tsx) `lg`/`xl` çakışma ve taşmaları giderildi; [`ShortsWatchClient.tsx`](../koup-app/src/components/shorts/ShortsWatchClient.tsx) bölüm aralık sekmeleri sarıldı ve kaynak butonları monokrom cam palete çekildi; [`ayarlar/page.tsx`](../koup-app/src/app/ayarlar/page.tsx) içine oynatıcı tercihleri (`koup_auto_skip_intro`, `koup_auto_next`, `koup_ambient_lighting`) eklendi.
- **Akış Çözücüleri:** [`resolve-stream/route.ts`](../koup-app/src/app/api/resolve-stream/route.ts), [`stream-proxy/route.ts`](../koup-app/src/app/api/stream-proxy/route.ts), [`api/sources/[mediaId]/route.ts`](../koup-app/src/app/api/sources/[mediaId]/route.ts), [`seri/[slug]/[episode]/page.tsx`](../koup-app/src/app/seri/[slug]/[episode]/page.tsx), [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) ve [`scrapers/stream_resolver.py`](../scrapers/stream_resolver.py) içinde `dramavadisi:`, `dramabox:`, `wdt:`, `pilavyer:` şemaları, Shortİzle Inertia v1/v2 + `gateway_bootstrap` + `mbdp` ve `dtpasn.asia` çerez oturumları onarıldı.
- **Kazıyıcılar & Arşiv Bütünlüğü:** [`database.py`](../database.py), [`scrapers/multisite.py`](../scrapers/multisite.py), [`scrapers/shortdrama/common.py`](../scrapers/shortdrama/common.py) ve [`koredizi.py`](../scrapers/shortdrama/koredizi.py) içindeki tuple/dict çökmeleri, yanlış `kisa_drama` atamaları, hash çakışmaları ve `pending://gap` kalıntıları temizlendi; Cloudflare Turnstile/403 durumlarında `SiteBlockedError` hızlı duruşu ve SQLite `scraper_checkpoints` uygulandı.

### Changed
- **Arşiv Düzeltme, Kadro & Kaynak Kurtarma (Faz C):** [`scripts/audit_and_heal_catalog.py`](../scripts/audit_and_heal_catalog.py), [`scripts/merge_all_duplicates.py`](../scripts/merge_all_duplicates.py), [`scripts/purge_dead_sources_full.py`](../scripts/purge_dead_sources_full.py), [`scripts/sync_cast_hierarchy.py`](../scripts/sync_cast_hierarchy.py) ve [`scripts/recover_and_heal_sources.py`](../scripts/recover_and_heal_sources.py) yükseltilip çalıştırıldı. Doğrulanmış 7.478 ölü kaynak temizlendi, 38 mükerrer yapım (ve 9 Supabase kopyası) ile 14 mükerrer kişi birleştirildi; 2.081 yapımın eksik kadrosu eklendi ve 716 yapımın rol hiyerarşisi dengelenerek 23.921 kadrolu yapımda tüm anomaliler sıfırlandı. Tüm kategorilerde eksiksiz boşluk/eksik bölüm kurtarması çalıştırılıp (`32.551` yapım, `1.041.295` kaynak) SQLite ↔ Supabase (`32.743` media / `254.077` senkron bölüm) ↔ Cloudflare R2 (`32.190` bundle / `db/webdrama_archive.db`) 3 katmanlı tam eşitlendi.

### Security
- **Sabit Anahtar Temizliği & SSRF / Proxy Sertleştirme:** [`api/takvim/live/route.ts`](../koup-app/src/app/api/takvim/live/route.ts) ve [`scripts/sync_real_calendars.py`](../scripts/sync_real_calendars.py) içindeki sabit token/TMDB anahtarı kaldırıldı. Yeni kimlik doğrulamalı vekiller [`api/admin/rpc/route.ts`](../koup-app/src/app/api/admin/rpc/route.ts), [`api/devices/revoke/route.ts`](../koup-app/src/app/api/devices/revoke/route.ts), [`api/episodes/reaction/route.ts`](../koup-app/src/app/api/episodes/reaction/route.ts) ve [`api/report-dead-source/route.ts`](../koup-app/src/app/api/report-dead-source/route.ts) eklendi; [`auto-enrich`](../koup-app/src/app/api/media/auto-enrich/route.ts), [`person/bio`](../koup-app/src/app/api/person/bio/route.ts) ve [`media/view`](../koup-app/src/app/api/media/view/route.ts) uçları sertleştirildi. Supabase göçleri (`create_dead_source_reports`, `fix_notifications_and_sync_episodes`, `security_and_performance_advisors_core`) ile güvenlik/performans advisor bulguları kapatıldı.

### Performance
- **4 Kademeli Mobil & Masaüstü Optimizasyonu:** [`DirectMediaCard.tsx`](../koup-app/src/components/DirectMediaCard.tsx) ve [`AccordionMediaCard.tsx`](../koup-app/src/components/AccordionMediaCard.tsx) `React.memo`, gecikmeli görsel çözme ve `.cv-auto` ile optimize edildi; [`layout.tsx`](../koup-app/src/app/layout.tsx) font ağırlıkları kırpılıp `preconnect`/`dns-prefetch` eklendi; [`globals.css`](../koup-app/src/app/globals.css) üzerinde `prefers-reduced-motion` kuralı tanımlandı ve `homeData.ts` dar sütun seçimiyle (`HOME_MEDIA_COLUMNS`, limit `180`) sorgu boyutu düşürüldü.
- **Veritabanı Boyutu & 500 MB Kota Sıkıştırması:** R2 JSON paketi doğrulanmış `32.190` yapımın yinelenen `episodes.video_sources` JSONB verisi (`117 MB`) temizlendi (`allow_null_video_sources_in_sync_episodes_items` göçü, [`sync_all_episodes_to_supabase.py`](../scripts/sync_all_episodes_to_supabase.py), [`supabase_sync_helper.py`](../scrapers/supabase_sync_helper.py) ve [`api/admin/catalog/route.ts`](../koup-app/src/app/api/admin/catalog/route.ts)); `VACUUM FULL` + `ANALYZE` ile Supabase PostgreSQL `590 MB` → `278 MB`, yerel SQLite `webdrama_archive.db` ise `VACUUM` sonrası `644,60 MB` → `559,73 MB` boyutuna indirildi.

---

## [2026-10-27] — Video Oynatıcı Tam Ekran 0ms Akıcı Geçişi, Beyaz Kenarlık Onarımı ve GitNexus Kurulumu

### Fixed
- `NetflixPlayer.tsx` & `globals.css`: Tam ekrana geçerken ve çıkarken oluşan 3 aşamalı takılmalı büyüme (tarayıcı native fullscreen'e girdikten sonra React `isFullscreen` state'inin gecikmesi ve çıkışta sekme içinde `fixed inset-0` olarak asılı kalması) giderildi:
  - `globals.css`: `#koup-player-container:fullscreen` ve `:-webkit-full-screen` seçicileri ile 0ms GPU/kompozitör seviyesinde anında `position: fixed; inset: 0; width: 100vw; height: 100vh; background: #000;` uygulanması sağlandı.
  - `NetflixPlayer.tsx`: `toggleFullscreen` fonksiyonuna anlık optimistik state güncellemesi ve `.catch()` hata geri alma koruması getirildi. `isNativeFs` (`document.fullscreenElement || webkitFullscreenElement`) kontrolüyle container layout'u ve boyutlandırması çift kilit ile güvenceye alındı; sekme içinde büyüme ve takılma tamamen ortadan kaldırıldı.
- `NetflixPlayer.tsx` & `globals.css`: Tam ekranda oynatıcı etrafında beliren 1px istenmeyen beyaz çerçeve/çizgi kaldırıldı. `#koup-player-container`, alt elemanları, `<video>` ve `<iframe>` etiketlerine `border: none; outline: none; ring-0; box-shadow: none;` uygulandı; geçişler GPU hızlandırmalı yumuşak animasyonla desteklendi.

### Added
- `Trail-Code`: Projeye Trail-Code (`@trailhq/trail-code`) kod zekası, Tree-sitter graft haritası ve oturum hafıza katmanı (`.trail/learnings/`) kuruldu. Antigravity ve Gemini için `~/.gemini/config/mcp_config.json`, `.gemini/settings.json`, `~/.gemini/skills/trail/SKILL.md` ve `AGENTS.md` entegre edildi; 1.721 düğüm ve 5.256 kenar indekslendi.
- `GitNexus`: Projeye GitNexus kod haritalama ve grafik indeksleme aracı kuruldu (`npx gitnexus setup -c antigravity` & `analyze`). Antigravity ortamı için 12 adet GitNexus skill'i, araçlar ve AfterTool hook'ları yapılandırıldı; 7.145 sembol, 15.572 bağımlılık ve 532 yürütme akışı indekslendi.

### Changed
- `docs/05-oynatici-ve-yayin-akisi.md`: Bölüm 3 altına "Tam Ekran (Fullscreen) Mimarisi ve Donanım Hızlandırmalı Geçişler" teknik dokümantasyonu eklendi.

---

## [2026-10-27] — Seri Sayfası Bölüm Listesine Tümünü İzlendi İşaretle Butonu

### Added
- `KoUpContext.tsx`: `markAllEpisodesWatched(media, episodeNumbers?, forceMark?)` fonksiyonu eklendi. Aktif kullanıcının ilgili diziye/sezona ait bölümlerini tek tıkla toplu olarak `watched_episodes` dizisine ekler veya geri alır; `koup_progress_v1` yerel hafızasını, bölüm pozisyonlarını ve Supabase `user_media_progress` tablosunu anında günceller.
- `SeriesDetailClient.tsx`: Bölüm listesi başlık alanına `CheckCheck` ikonlu, cam hap (glass-pill) tasarımlı "Tümünü İzlendi İşaretle" / "Tümü İzlendi" butonu entegre edildi. Aktif sezondaki yayınlanmış tüm bölümlerin izlenip izlenmediğini dinamik olarak takip eder, tıklandığında ses efekti (`complete` / `click`) ve toast bildirimi tetikler; tekrar tıklandığında işaretleri temizler.

### Changed
- `docs/03-sayfalar-ve-rotalar.md`: Dizi detay sayfası kullanıcı etkileşimlerine bölüm listesi toplu izlendi işaretleme özelliği eklendi.
- `docs/10-kullanici-ozellikleri.md`: `markAllEpisodesWatched` anında senkronizasyon tetikleyicisi olarak belgelendi.

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
