# Changelog

Bu dosya, KoUp platformunda yapılan tüm önemli geliştirmeleri, mimari kararları, hata düzeltmelerini, güvenlik iyileştirmelerini ve dokümantasyon güncellemelerini [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatında listeler.

### Sürüm ve Değişiklik Türleri
- **Added:** Sisteme eklenen yeni özellikler, sayfalar, bileşenler, scriptler veya tablolar.
- **Changed:** Mevcut işlevlerde yapılan mimari, UI veya davranış değişiklikleri.
- **Fixed:** Düzeltilen hatalar, kırık video akışları veya mantıksal problemler.
- **Security:** Güvenlik açığı düzeltmeleri, RLS politikaları, advisor onarımları ve yetki kontrolleri.
- **Performance:** Hız optimizasyonları, önbellek iyileştirmeleri ve Core Web Vitals kazanımları.

---

## [2026-11-22] — Phase 3 Mobil Sol Panel (60fps Doğal `<dialog>` Drawer), SSR/CLS Onarımı & Derin Mobil Kaynak Optimizasyonu

### Performance
- **Mobil Sol Çekmece (`Navbar.tsx` + `globals.css`) 60fps Kompozitör Yeniden Mimarisi:** Kasma oluşturan `backdrop-blur-2xl` (çekmece), `backdrop-blur-sm` (arka plan), `blur-3xl` (parlama küresi), animasyon ortasında layout reflow tetikleyen `document.body.style.overflow` mutasyonu, açılışta 12 eşzamanlı RSC isteği başlatan `prefetch={true}` bağlantıları ve Framer Motion mount/unmount döngüsü kaldırıldı. Yerine tarayıcının üst katman (`top-layer`) doğal `<dialog id="mobile-nav-drawer">` + CSS `scroll-snap-type: x mandatory` (doğal parmakla kaydırma) + `@supports (animation-timeline: scroll())` ile senkronize `::backdrop` karartması (ve eski tarayıcılar için JS scroll/`scroll-initial-target` yedeği) + sıfır React re-render imperatif `aria-expanded` kontrolü uygulandı. Mobil sol panel `6x` düşük mobilde `11 FPS (283 ms max kare, 367 ms LT, 12 ağ isteği) → 35–49 FPS (0 ağ isteği)`, `4x` orta mobilde `49 → 55–60 FPS`, `2x` yüksek mobilde `58 → 60 FPS / 17 ms / 0 jank` seviyesine çıktı.
- **Seri Detay SSR Kurtarma & CLS Onarımı (`SeriesDetailClient.tsx` + `seri/[slug]/page.tsx`):** `SeriesDetailClient` içindeki `useSearchParams()` çağrısı `useEffect` içinde `window.location.search` okumasına çevrilerek `<Suspense fallback={null}>` kaynaklı SSR iptali giderildi; `/seri/dexter` `6x` mobil **CLS `0.8679 → 0.0005`**, `2x` mobil **LCP `2.020 ms → 400 ms` (`-80%`)** oldu.
- **Çift Sayfa Geçişi & Hero SSR İlk Boyama (`template.tsx` + `HomeClient.tsx`):** `layout.tsx` içindeki `<PageTransition>` ile çakışan ve ilk boyamayı `opacity: 0` ile bekleten yinelenen `template.tsx` `<motion.div>` sarmalayıcısı kaldırıldı; `HomeClient.tsx` Hero `<AnimatePresence initial={false}>` ile LCP görselinin 0. karede boyanması sağlandı. `/` `6x` mobil **LCP `1.628 ms → 364 ms` (`-78%`)**, `4x` mobil **LCP `852 ms → 248 ms` (`-71%`)**, PC **LCP `276 ms → 132 ms` (`-52%`)** oldu.
- **Akıllı Ekran Altı Yükleme & Hafif Kart Mimarisi (`useDeferredMount.ts` + `AccordionMediaCard.tsx` + `Footer.tsx` + `KoUpContext.tsx`):** `useDeferredMount` her 16ms `rAF`'ta tüm şeritleri yüklemek yerine `IntersectionObserver` (`600px` ön bakış) + nazik boşta doldurma akışına geçirildi (`/` mobil DOM `2.114 → 954`, `-55%`; aktarım `-25%`). `AccordionMediaCard` üzerinde poster boyutu `w342` yapıldı, 6 kart-başına store aboneliği ve ~20 gizli hover DOM düğümü yalnızca masaüstü ilk hover anında yüklenecek şekilde ayrıldı (`/kesfet` DOM `-34%`, JS Heap `-21%` ila `-34%`). `KoUpContext` cihaz parmak izi/ban kontrolü `runWhenIdle` içine alındı ve `ConfirmModal` yalnızca açıkken mount edilir hale getirildi.
- **İzleme Sayfaları & Mobil GPU Blur Azaltımı (`[episode]/page.tsx`, `EpisodeRail.tsx`, `ShortsWatchClient.tsx`, `KoupInput.tsx`, `Navbar.tsx`):** Video oynatıcı arkasındaki tam ekran `blur-[100px]` / `blur(70px)` ve mobildeki çok katmanlı `backdrop-blur-xl/2xl` katmanları masaüstünde `w92 + blur-lg/24px`, mobilde sıfır blur maliyetli OLED mat/radyal yüzeylere dönüştürüldü (`/seri/dexter/1?season=1` mobil kaydırma FPS: `2x` `28 → 55 FPS`, `4x` `25 → 43 FPS`, `6x` `25 → 47 FPS`).

---

## [2026-11-22] — Phase 2 Benchmark Odaklı 4 Kademeli Performans Optimizasyonu (Sıfır Görsel Değişiklik)

### Changed
- **Ana Sayfa & Seri Detay Başlık Üstü Sadeleştirme:** [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) bölüm başlıklarının üstünde yer alan tekrarlı/gereksiz eyebrow ve rozet etiketleri (`Kişisel Arşiv`, `Son Eklenenler`, `Yeni Yapımlar`, `Trend Diziler`, `Trend Filmler`, `SHORTS`, `Sana Özel Seçki`) ile [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) içindeki `Benzer Yapımlar` üst etiketi (`Akıllı Eşleşme`) kaldırılarak başlıklar ve sağ aksiyon kontrolleri tek satırda sadeleştirildi.

### Performance
- **Paket Bölme & Tree-Shaking:** [`next.config.mjs`](../koup-app/next.config.mjs) içinde `experimental.optimizePackageImports` (`lucide-react`, `motion`, `motion/react`, `@supabase/supabase-js`) etkinleştirildi. [`LazyShortsDetailClient.tsx`](../koup-app/src/components/shorts/LazyShortsDetailClient.tsx) ile dikey kısa drama paketi normal `/seri/[slug]` sayfalarından ayrıştırılarak First Load JS `332 kB → 287 kB` (`-45 kB`) seviyesine düşürüldü. [`AuthModal`](../koup-app/src/components/Navbar.tsx), [`AddToListModal`](../koup-app/src/components/AccordionMediaCard.tsx) ve [`DeferredCookieBanner.tsx`](../koup-app/src/components/DeferredCookieBanner.tsx) yalnızca ihtiyaç anında/boşta yüklenecek şekilde `next/dynamic` ile bölündü.
- **Ana Sayfa (`/`) Çift Fetch İptali & LCP İyileştirmesi:** [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) içinde SSR `initialBundle` varken açılışta tetiklenen 11 yinelenen istemci Supabase sorgusu iptal edildi; medya önbellek kaydı [`yieldToMain.ts`](../koup-app/src/lib/yieldToMain.ts) (`scheduler.yield()` + `setTimeout(0)` yedeği ve `runWhenIdle`) ile bölünerek ana iş parçacığı açıldı. Masaüstü/mobil vitrin görselleri `original` yerine `w1280` / `w780`, vitrin küçük resimleri `w300`, kart afişleri `w342` (`DirectMediaCard.tsx` ve Top 10) olarak optimize edildi; YouTube IFrame API ve sonraki slayt ön yüklemesi LCP sonrasına ertelendi. PC veri transferi `5.241 KB → 3.404 KB` (`-35%`), mobil veri transferi `3.942 KB → 2.102 KB` (`-47%`), PC LCP `636 ms → 396 ms` (`-38%`), TBT `30 ms → 0 ms` seviyesine indirildi.
- **Seri Detay (`/seri/[slug]`) `React.cache` & Dar Sorgular:** [`seriesData.ts`](../koup-app/src/lib/server/seriesData.ts) içinde `getSeriesDataServer` React `cache()` ile sarmalanarak `generateMetadata` + sayfa render arasındaki yinelenen Supabase/R2 okumaları yarıya indirildi ve `media_cast` sorgusu daraltıldı. [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) içinde SSR verisi varken yinelenen istemci sorgusu, başlangıçtaki gizli oyuncu avatar ön çözümü (`w185` ve etkileşimde yükleme), bitmiş yapımlardaki gereksiz Realtime WebSocket kanalı ve eksik veri yoksa `/api/media/trailer` çağrısı kaldırıldı/ertelendi. `/seri/dexter` TTFB tüm mobil profillerde `%26–37`, veri transferi `%35–46`, 6x Mobil TBT `%35` (`711 ms → 464 ms`) azaldı.
- **SSR / ISR Dönüşümü (`/takvim`, `/kesfet`, `/oyuncular`, `/son-eklenenler`):** Paylaşılan sunucu veri yardımcıları [`takvimData.ts`](../koup-app/src/lib/server/takvimData.ts) ve [`catalogData.ts`](../koup-app/src/lib/server/catalogData.ts) eklenerek 4 ana liste sayfası ISR Server Component (`revalidate: 180–300`) mimarisine geçirildi, `select('*')` sorguları daraltıldı ve `/api/takvim/live` `s-maxage=120, stale-while-revalidate=300` önbelleklemesine alındı. `/takvim` PC LCP `796 ms → 252 ms` (`-68%`), 6x Mobil FPS `25 → 42`; `/kesfet` PC LCP `560 ms → 312 ms` (`-44%`), 6x Mobil TBT `669 ms → 409 ms` (`-39%`) olarak iyileşti.
- **CSS Containment (`content-visibility: auto`):** [`globals.css`](../koup-app/src/app/globals.css) `.cv-auto` kuralı `contain-intrinsic-block-size: auto 360px` ile güncellendi ve yalnızca ekran altı (below-the-fold) bölümlere uygulandı.

### Fixed
- **React Hydration `#418` Tam Temizliği (Masaüstü & Mobil / Geri Dönen Oturumlar):** [`TakvimClient.tsx`](../koup-app/src/app/takvim/TakvimClient.tsx) sunucudan deterministik `initialDay` (UTC+3) alacak şekilde yenilendi; [`KoUpContext.tsx`](../koup-app/src/context/KoUpContext.tsx) (`isTrailerMuted`) ve [`seri/[slug]/[episode]/page.tsx`](../koup-app/src/app/seri/[slug]/[episode]/page.tsx) (`ambientLightingEnabled`, `autoNextEnabled`) `useState` başlangıçları deterministik hale getirildi; [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) bölüm ilerleme göstergesi `isHydrated` sonrası render edilecek, [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) ve [`SonEklenenlerClient.tsx`](../koup-app/src/app/son-eklenenler/SonEklenenlerClient.tsx) göreli zaman etiketleri `suppressHydrationWarning` ile korunacak şekilde düzeltildi (`0` hydration / konsol hatası doğrulandı).

---

## [2026-11-22] — Phase 1 Tam Arşiv, Oynatıcı, Takvim, Kadro, Seri Evreni, Çeviri & GitHub Actions Onarımı

### Fixed
- **Video Çözücüler, Proxy & Önceliklendirme (`Dexter` S1B1 & Arşiv Geneli):** [`resolve-stream/route.ts`](../koup-app/src/app/api/resolve-stream/route.ts), [`stream-proxy/route.ts`](../koup-app/src/app/api/stream-proxy/route.ts), [`api/sources/[mediaId]/route.ts`](../koup-app/src/app/api/sources/[mediaId]/route.ts), [`scrapers/stream_resolver.py`](../scrapers/stream_resolver.py) ve [`scripts/export_sources_bundles.py`](../scripts/export_sources_bundles.py) güncellendi. `storage.diziyou.one` adresleri hem çözümleyicide hem de `22.603` kaynakta (`1.107` yapım / `804` `source_url`) `storage.diziyou.love` alanına geçirildi (`20/20` canlı `200`). `pilavyer` çözümleyicisi kaynağın kendi hostunu (`pilavyerplay.top` / `play2.pilavyerplay.top`) önceleyecek ve `window.__PLAYER__.subs` altyazılarını ayrıştıracak şekilde onarıldı. `diziyou-hls` ve doğrudan `.m3u8` geçişlerine 4 saniyelik `#EXTM3U` canlılık kontrolü (`410 isDead: true`) eklendi; doğrulanan `45.022` ölü `hdfilmcehennemi.mobi` kaynağı (yalnızca alternatifi bulunan bölümlerden) silindi, `hdfilm-close` ve `dplayer82`/`dizilla` (`NP_GATE`) Tier `8` önceliğine düşürüldü.
- **Yayın Takvimi (`/takvim`):** [`scrapers/sites/animelvl.py`](../scrapers/sites/animelvl.py) seçicisi tüm katalog yerine gün/bölüm konteynerine sınırlandı (`4.134` bayat satır temizlendi); [`scripts/sync_real_calendars.py`](../scripts/sync_real_calendars.py) tüm anime kataloğunu sayfalandırıp `8` günden eski kayıtları temizleyecek şekilde yenilendi (sabit TMDB anahtarı kaldırıldı). [`api/takvim/live/route.ts`](../koup-app/src/app/api/takvim/live/route.ts) `8` günlük pencere ve `updated_at DESC` sıralamasıyla PostgREST 1.000 satır kesilmesinden kurtarıldı (`239` güncel haftalık yayın kaydı eşitlendi).
- **GitHub Actions & Otomasyon:** [`.github/workflows/admin_job.yml`](../.github/workflows/admin_job.yml), [`scraper_cron.yml`](../.github/workflows/scraper_cron.yml) ve [`sync_single_series.yml`](../.github/workflows/sync_single_series.yml) iş akışlarında UTF-8 Türkçe bozulmaları düzeltildi, `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ve `scraper_cron.yml` için `concurrency` kilidi eklendi; [`scripts/cron_sync_pipeline.py`](../scripts/cron_sync_pipeline.py) yeni seri otomasyon bağlaması ve takvim temizleme sırası düzeltildi.
- **Yanlış Dış Kimlikler, Anime↔Live-Action Ayrımı & Mükerrer Birleştirme:** Çakışan MDL/AniList/TMDB/IMDb grupları canlı API doğrulamasıyla temizlendi (`85+` hatalı dış ID/ülke düzeltildi, anime olup yanlışlıkla `dizi` etiketlenen *Attack on Titan*, *Aku no Hana*, *DOTA: Dragon's Blood*, *Avatar*, *Sekai Saikou no Ansatsusha* ve *Tomb Raider S1* düzeltildi). [`scripts/merge_all_duplicates.py`](../scripts/merge_all_duplicates.py) sezon/sıra normalizasyonu ile çalıştırılarak `23` mükerrer yapım (`49` bölüm, `198` kaynak) birleştirildi; ek olarak `+25` TMDB/IMDb ve toplu GraphQL ile `+74` AniList ID tamamlandı (`anime_with_mdl = 0`, `non_anime_with_anilist = 0`).
- **Oyuncular, Başrol Hiyerarşisi & Romanizasyon Tekilleştirme:** Aynı yapımdaki `17` doğrulanmış romanizasyon/takma ad aktör çifti (`Kim Byung Chul`/`Kim Byong-chul`, `EL`/`Lee El`, `Lee Sin-young`/`Lee Shin Young`, `Cheng Lei`/`Ryan Cheng` vb.) birleştirildi. [`scripts/sync_cast_hierarchy.py`](../scripts/sync_cast_hierarchy.py) TMDB `/tv/{id}/aggregate_credits` ve romanizasyon korumasıyla çalıştırılarak `64` eksik kadro dolduruldu, `1.639` yapımın rol/sıra hiyerarşisi onarıldı (`4.370` güncelleme) ve `26` anomali dengelendi (`Squid Game`'de *Lee Byung Hun*, `Goblin`'de *Yook Sung-jae* başrol oldu).
- **Seri Evreni (`franchise_graph.json` & Supabase `franchise_items`):** [`scripts/build_franchise_graph.py`](../scripts/build_franchise_graph.py) anime ve live-action evrenlerini kesin ayıracak, bayat Supabase kayıtlarını sıfırlayacak ve aynı ülkeli live-action spin-off evrenlerini (`Dexter` 4 yapım vb.) bağlayacak şekilde güncellenip çalıştırıldı (`1.541` seri ailesi, `4.876` Supabase kaydı, `0` karma anime/live-action evreni).
- **Eksik & İngilizce Özetlerin Türkçeleştirilmesi:** [`scrapers/translator.py`](../scrapers/translator.py) `clients5.google.com` öncelikli çoklu çeviriye geçirildi; TMDB `tr-TR` ve toplu çeviriyle `1.142` özet Türkçeleştirilip SQLite ve Supabase üzerinde eşitlendi (`İngilizce/yabancı özet: 1.145 → 5`, `0` hata).

### Verified Storage & Database Health
- Tüm kaynak JSON paketleri (`32.168` bundle, `930.149` kaynak) yeniden dışa aktarıldı, Cloudflare R2 (`sources/` + `db/webdrama_archive.db`) ve Supabase (`277 MB` DB boyutu, `0` advisor `ERROR`) 3 katmanlı olarak eşitlendi.

---

## [2026-11-22] — Shortİzle Edge Çözücü, Sıfır Kaynaklı Kısa Drama Temizliği, Admin 4 Kademeli Benchmark & Supabase İndeks Optimizasyonu

### Added
- **Admin-Only 4 Kademeli Performans & İnteraktif Benchmark Laboratuvarı:** [`AdminBenchmarkSuite.tsx`](../koup-app/src/components/admin/AdminBenchmarkSuite.tsx) ve [`/api/admin/benchmark`](../koup-app/src/app/api/admin/benchmark/route.ts) eklendi (`role === 'admin'` zorunlu, `adminOnly: true`). PC (`1x`), Yüksek Mobil (`2x`), Orta Mobil (`4x`) ve Düşük Mobil (`6x`) profillerinde tüm ana/katalog/detay/oynatıcı sayfalarını canlı yükleyerek TTFB, FCP, LCP, CLS, TBT, FPS/takılma, canlı buton tıklama gecikmesi (INP), DOM boyutu, yatay taşma, konsol hataları ile Supabase/R2/Edge API sürelerini ölçer; darboğazları sıralar ve JSON/Markdown rapor dışa aktarır.
- **Cloudflare Edge Worker `/shortizle` Çözücüsü:** [`cloudflare/worker.js`](../cloudflare/worker.js) içine `/shortizle` ucu eklenip `koup-edge-worker` canlıya dağıtıldı; [`resolve-stream/route.ts`](../koup-app/src/app/api/resolve-stream/route.ts) doğrudan istek Vercel AWS IP'sinde `403` aldığında otomatik Edge Worker yedeğine düşer.

### Fixed
- **Shortİzle `403` Yanlış Ölü İşaretleme & Sıfır Kaynaklı Kısa Dramalar:** [`report-dead-source/route.ts`](../koup-app/src/app/api/report-dead-source/route.ts) içinde Cloudflare/WAF `403/429/5xx` yanıtlarının canlı Shortİzle kaynaklarını `verifiedDead` işaretlemesi engellendi ve `media_id = 55109` (`Sahte Ölüm Tuzağı`) için düşen 6 sahte `shortizle_http_403` kaydı temizlendi. Gerçekten `0` canlı kaynağa sahip `59` adet `kisa_drama` yapımı SQLite (`webdrama_archive.db`), Cloudflare R2 (`sources/*.json` + `db/webdrama_archive.db`) ve Supabase (`public.media`) üzerinde 3 katmanlı olarak temizlendi (`remaining_zero_source_shorts: 0`).
- **Çalışma Alanı Temizliği:** Kullanılmayan `.trail/`, `.gitnexus/`, `.claude/`, `.agents/`, `.gemini/`, `AGENTS.md`, `CLAUDE.md`, `opencode.json`, `.ignore`, `audit_reports/`, `logs/` ve `__pycache__` kalıntıları proje dizininden kaldırıldı ve [`.gitignore`](../.gitignore) güncellendi.

### Changed
- **Ana Sayfa & Seri Detay Başlık Üstü Sadeleştirme:** [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) bölüm başlıklarının üstünde yer alan tekrarlı/gereksiz eyebrow ve rozet etiketleri (`Kişisel Arşiv`, `Son Eklenenler`, `Yeni Yapımlar`, `Trend Diziler`, `Trend Filmler`, `SHORTS`, `Sana Özel Seçki`) ile [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) içindeki `Benzer Yapımlar` üst etiketi (`Akıllı Eşleşme`) kaldırılarak başlıklar ve sağ aksiyon kontrolleri tek satırda sadeleştirildi.

### Performance
- **Supabase İndeks Optimizasyonu (Supabase CLI):** Yinelenen ve kullanılmayan 14 yabancı-anahtar dışı indeks (`idx_episodes_media`, `idx_episodes_published_nonnull`, `idx_media_browse_rating`, `idx_media_browse_latest`, `idx_media_type_rating`, `idx_media_country_ratings`, `idx_media_views_total_default`, `idx_franchise_items_mid`, `idx_franchise_items_fid` vb.) `supabase db query` ile kaldırılarak veritabanı boyutu `281 MB` → `261 MB` seviyesine düşürüldü (0 performans hatası/uyarısı).

---

## [2026-11-21] — Tam Arşiv Onarımı, Kısa Drama Dikey Oynatıcı, Güvenlik/Advisor Sertleştirme & 4 Kademeli Performans

### Fixed
- **Bildirim & Son Eklenenler Koruması:** [`scrapers/supabase_sync_helper.py`](../scrapers/supabase_sync_helper.py), [`scripts/sync_all_episodes_to_supabase.py`](../scripts/sync_all_episodes_to_supabase.py), [`api/admin/sync-series/route.ts`](../koup-app/src/app/api/admin/sync-series/route.ts), [`homeData.ts`](../koup-app/src/lib/server/homeData.ts), [`son-eklenenler/page.tsx`](../koup-app/src/app/son-eklenenler/page.tsx) ve [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) güncellendi; mevcut bölümlere kaynak eklendiğinde `"published_at": None` gönderilerek sahte bildirim ve ana sayfa sıçraması önlendi. `/son-eklenenler` sayfasında `count: 'estimated'` ve mobil filtre taşma/kırpılma onarımı uygulandı.
- **Kısa Drama, Oynatıcı & Arayüz Bütünlüğü:** [`NetflixPlayer.tsx`](../koup-app/src/components/NetflixPlayer.tsx) içinde tüm açılır menü ve mobil alt sayfalar (`#0d0e13/95` koyu cam, tek tip ikon/anahtar) ile hizalandı; dikey 9:16 oynatıcıda ses çubuğu yüzen hap içine alındı, kalite/hız/ayar popover'ları ilerleme çubuğunun üzerine yükseltildi ve yatay ayarlar/kalite panelleri sağa yaslandı (`right-0`). Çalışmayan/ölü kaynaklar dropdown, kaynak hapı ve hata ekranından gizlenip arka planda [`report-dead-source`](../koup-app/src/app/api/report-dead-source/route.ts) (`4000` karakter sınırı) üzerinden bildirilir hale getirildi. [`Navbar.tsx`](../koup-app/src/components/Navbar.tsx) `lg`/`xl` çakışma ve taşmaları giderildi; [`ShortsWatchClient.tsx`](../koup-app/src/components/shorts/ShortsWatchClient.tsx) bölüm aralık sekmeleri sarıldı ve kaynak butonları monokrom cam palete çekildi; [`ayarlar/page.tsx`](../koup-app/src/app/ayarlar/page.tsx) içine oynatıcı tercihleri (`koup_auto_skip_intro`, `koup_auto_next`, `koup_ambient_lighting`) eklendi. [`ShortsRail.tsx`](../koup-app/src/components/home/ShortsRail.tsx) ve [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) Kısa Dramalar & Sana Özel öneri şeritlerindeki hover/scale kırpılma taşmaları giderildi; [`DirectMediaCard.tsx`](../koup-app/src/components/DirectMediaCard.tsx) odak/hover animasyonu [`ShortsCard.tsx`](../koup-app/src/components/shorts/ShortsCard.tsx) ile eşitlendi ve [`.gitignore`](../.gitignore) güncellenerek ajan/IDE/graf dosyaları Git takibinden çıkarıldı.
- **Akış Çözücüleri:** [`resolve-stream/route.ts`](../koup-app/src/app/api/resolve-stream/route.ts), [`stream-proxy/route.ts`](../koup-app/src/app/api/stream-proxy/route.ts), [`api/sources/[mediaId]/route.ts`](../koup-app/src/app/api/sources/[mediaId]/route.ts), [`seri/[slug]/[episode]/page.tsx`](../koup-app/src/app/seri/[slug]/[episode]/page.tsx), [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) ve [`scrapers/stream_resolver.py`](../scrapers/stream_resolver.py) içinde `dramavadisi:`, `dramabox:`, `wdt:`, `pilavyer:` şemaları, Shortİzle Inertia v1/v2 + `gateway_bootstrap` + `mbdp` ve `dtpasn.asia` çerez oturumları onarıldı.
- **Kazıyıcılar & Arşiv Bütünlüğü:** [`database.py`](../database.py), [`scrapers/multisite.py`](../scrapers/multisite.py), [`scrapers/shortdrama/common.py`](../scrapers/shortdrama/common.py) ve [`koredizi.py`](../scrapers/shortdrama/koredizi.py) içindeki tuple/dict çökmeleri, yanlış `kisa_drama` atamaları, hash çakışmaları ve `pending://gap` kalıntıları temizlendi; Cloudflare Turnstile/403 durumlarında `SiteBlockedError` hızlı duruşu ve SQLite `scraper_checkpoints` uygulandı.

### Changed
- **Arşiv Düzeltme, Kadro & Kaynak Kurtarma (Faz C):** [`scripts/audit_and_heal_catalog.py`](../scripts/audit_and_heal_catalog.py), [`scripts/merge_all_duplicates.py`](../scripts/merge_all_duplicates.py), [`scripts/purge_dead_sources_full.py`](../scripts/purge_dead_sources_full.py), [`scripts/sync_cast_hierarchy.py`](../scripts/sync_cast_hierarchy.py) ve [`scripts/recover_and_heal_sources.py`](../scripts/recover_and_heal_sources.py) yükseltilip çalıştırıldı. Doğrulanmış 7.478 ölü kaynak temizlendi, 38 mükerrer yapım (ve 9 Supabase kopyası) ile 14 mükerrer kişi birleştirildi; 2.081 yapımın eksik kadrosu eklendi ve 716 yapımın rol hiyerarşisi dengelenerek 23.921 kadrolu yapımda tüm anomaliler sıfırlandı. Tüm kategorilerde eksiksiz boşluk/eksik bölüm kurtarması çalıştırılıp (`32.551` yapım, `1.041.295` kaynak) SQLite ↔ Supabase (`32.743` media / `254.077` senkron bölüm) ↔ Cloudflare R2 (`32.190` bundle / `db/webdrama_archive.db`) 3 katmanlı tam eşitlendi.

### Security
- **Sabit Anahtar Temizliği & SSRF / Proxy Sertleştirme:** [`api/takvim/live/route.ts`](../koup-app/src/app/api/takvim/live/route.ts) ve [`scripts/sync_real_calendars.py`](../scripts/sync_real_calendars.py) içindeki sabit token/TMDB anahtarı kaldırıldı. Yeni kimlik doğrulamalı vekiller [`api/admin/rpc/route.ts`](../koup-app/src/app/api/admin/rpc/route.ts), [`api/devices/revoke/route.ts`](../koup-app/src/app/api/devices/revoke/route.ts), [`api/episodes/reaction/route.ts`](../koup-app/src/app/api/episodes/reaction/route.ts) ve [`api/report-dead-source/route.ts`](../koup-app/src/app/api/report-dead-source/route.ts) eklendi; [`auto-enrich`](../koup-app/src/app/api/media/auto-enrich/route.ts), [`person/bio`](../koup-app/src/app/api/person/bio/route.ts) ve [`media/view`](../koup-app/src/app/api/media/view/route.ts) uçları sertleştirildi. Supabase göçleri (`create_dead_source_reports`, `fix_notifications_and_sync_episodes`, `security_and_performance_advisors_core`) ile güvenlik/performans advisor bulguları kapatıldı.

### Changed
- **Ana Sayfa & Seri Detay Başlık Üstü Sadeleştirme:** [`HomeClient.tsx`](../koup-app/src/app/HomeClient.tsx) bölüm başlıklarının üstünde yer alan tekrarlı/gereksiz eyebrow ve rozet etiketleri (`Kişisel Arşiv`, `Son Eklenenler`, `Yeni Yapımlar`, `Trend Diziler`, `Trend Filmler`, `SHORTS`, `Sana Özel Seçki`) ile [`SeriesDetailClient.tsx`](../koup-app/src/app/seri/[slug]/SeriesDetailClient.tsx) içindeki `Benzer Yapımlar` üst etiketi (`Akıllı Eşleşme`) kaldırılarak başlıklar ve sağ aksiyon kontrolleri tek satırda sadeleştirildi.

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
