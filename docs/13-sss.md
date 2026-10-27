# KoUp Sıkça Sorulan Sorular (SSS / FAQ)

Bu doküman, KoUp platformunun mimarisi, geliştirme kuralları, video oynatıcı motoru, arşiv senkronizasyonu, güvenlik mekanizmaları ve günlük operasyonları hakkında en sık karşılaşılan soruları ve doğrulanmış çözümlerini içerir.

---

## İçindekiler
1. [Genel & Mimari](#1-genel--mimari)
2. [Geliştirme & Ortam](#2-geliştirme--ortam)
3. [Tasarım, Bileşenler & UI/UX](#3-tasarım-bileşenler--uiux)
4. [Oynatıcı (Player) & Video Akışı](#4-oynatıcı-player--video-akışı)
5. [Veri Katmanı, Arşiv & Senkronizasyon](#5-veri-katmanı-arşiv--senkronizasyon)
6. [Güvenlik, Kimlik Doğrulama & İzinler](#6-güvenlik-kimlik-doğrulama--izinler)
7. [Yönetim Paneli & Moderasyon](#7-yönetim-paneli--moderasyon)
8. [Dağıtım (Deploy), Ağ & Cloudflare](#8-dağıtım-deploy-ağ--cloudflare)
9. [Dokümantasyon & Proje Kuralları](#9-dokümantasyon--proje-kuralları)
10. [İlgili Dokümanlar](#10-ilgili-dokümanlar)

---

## 1. Genel & Mimari

### S1. KoUp tam olarak nedir ve hangi içerikleri kapsar?
**Cevap:** KoUp; Kore dizileri (K-Drama), Çin dizileri (C-Drama), Japon yapımları, Asya animeleri (Donghua ve Japon anime), sinema filmleri ve 9:16 formatında dikey kısa dramaları (short drama) bir arada sunan, Apple TV+ ve Netflix kalitesinde tasarlanmış yeni nesil bir streaming ve arşiv ekosistemidir [bkz. 01-genel-bakis-ve-mimari.md](./01-genel-bakis-ve-mimari.md).

### S2. KoUp'un 3 katmanlı mimarisi nasıl çalışır?
**Cevap:**
1. **İstemci Katmanı (Frontend):** Next.js 15 App Router, React 19 ve Tailwind v4 ile sunulan yüksek performanslı OLED arayüz.
2. **Dağıtık Depolama & CDN Katmanı:** Cloudflare R2 üzerindeki tekil JSON paketleri (`sources/{id}.json`) ve Cloudflare Worker edge akışları.
3. **İlişkisel Veritabanı Katmanı:** Supabase PostgreSQL (kullanıcılar, profiller, favoriler, izleme geçmişi, yorumlar, temel medya/bölüm metadata'sı). Detaylı akış için [bkz. 01-genel-bakis-ve-mimari.md](./01-genel-bakis-ve-mimari.md).

### S3. Neden hem SQLite hem Cloudflare R2 hem de Supabase kullanılıyor?
**Cevap:** Supabase ücretsiz/standart katmanında veritabanı boyutu (500MB) kısıtlıdır. 17.000+ yapım ve 230.000+ bölümün tüm video sağlayıcı linkleri, ham kazıma kayıtları ve geçmişleri Postgres'te tutulursa veritabanı birkaç gigabayta şişer. Bu nedenle:
- **Yerel SQLite (`webdrama_archive.db`):** 570.000+ ham video kaynağının ana arşiv deposudur.
- **Cloudflare R2:** Yapım başına tekil JSON dosyaları barındırarak <15ms CDN erişimi sağlar ve sıfır Postgres yükü yaratır.
- **Supabase:** Sadece filtrelenmiş en iyi 2-3 sağlayıcı kaynağını ve ilişkisel kullanıcı verilerini barındırır [bkz. 08-veri-katmani.md](./08-veri-katmani.md).

### S4. Franchise ve İzleme Sırası (Watch Order) motoru nasıl çalışır?
**Cevap:** [`FranchiseWatchOrder.tsx`](../koup-app/src/components/FranchiseWatchOrder.tsx) bileşeni, derlenmiş `franchise_graph.json` grafiğini kullanarak aynı evrene ait ana sezonları, devam halkalarını, sinema filmlerini, OVA/OAD özel bölümlerini ve yan dizileri kronolojik bir zaman çizelgesinde sunar. Bu sayede aynı serinin diğer sezonları "Benzer Yapımlar" listesini kirletmez [bkz. 10-kullanici-ozellikleri.md](./10-kullanici-ozellikleri.md).

### S5. AsyaMag magazin haberleri nereden ve nasıl çekilir?
**Cevap:** AsyaMag haberleri, `asyamag.com` WordPress REST API ucu (`wp-json/wp/v2/posts`) üzerinden çekilir, sunucu tarafında önbelleğe alınır ve kullanıcı harici bir siteye yönlendirilmeden KoUp arayüzü içinde şık bir okuma deneyimiyle gösterilir [bkz. 06-api-referansi.md](./06-api-referansi.md).

---

## 2. Geliştirme & Ortam

### S6. Yerel geliştirme ortamı nasıl ayağa kaldırılır?
**Cevap:**
1. Depoyu klonlayın ve kök dizine girin.
2. `koup-app/` klasöründe `pnpm install` çalıştırın.
3. `koup-app/.env.local` dosyasını oluşturup gerekli Supabase ve R2 ortam değişkenlerini tanımlayın.
4. Python scriptleri için kök dizinde `pip install -r requirements.txt` çalıştırın.
5. `cd koup-app && pnpm dev` ile web uygulamasını başlatın [bkz. 02-kurulum-ortam-ve-deploy.md](./02-kurulum-ortam-ve-deploy.md).

### S7. Neden `npm run dev` veya `pnpm dev` durduk yere kendi kendine başlatılmamalıdır?
**Cevap:** Arka planda unutulan dev sunucuları `localhost:3000` portunu işgal eder, hafıza tüketir ve `.next` önbelleğini kilitleyerek derleme (`npm run build`) ve tip kontrolü (`npx tsc --noEmit`) süreçlerini bozar. Dev server yalnızca manuel test gerektiğinde başlatılmalı ve iş bitince sonlandırılmalıdır [bkz. 12-kurallar-ve-yasaklar.md#61-durduk-yere-dev-server-başlatmama-disiplini](./12-kurallar-ve-yasaklar.md#61-durduk-yere-dev-server-başlatmama-disiplini).

### S8. Tip kontrolü (TypeScript) nasıl yapılmalıdır?
**Cevap:** `.next` önbelleğini bozmamak ve hızlı sonuç almak için `koup-app/` dizininde `npx tsc --noEmit` komutu kullanılmalıdır.

### S9. Ortam değişkenleri nereye eklenmelidir?
**Cevap:** Tüm yerel ortam değişkenleri `koup-app/.env.local` dosyasına eklenmelidir. Üretim ortamı için ise Vercel Dashboard ve Cloudflare Dashboard üzerindeki Environment Variables alanları kullanılır. Değişken isimleri için [bkz. 02-kurulum-ortam-ve-deploy.md](./02-kurulum-ortam-ve-deploy.md).

### S10. Kod yazarken neden RTK (`rtk`) kullanılmalıdır?
**Cevap:** Geliştirme terminalinde token tasarrufu sağlamak amacıyla shell komutlarının başına `rtk` eklenir (`rtk git status`, `rtk npx tsc --noEmit`). RTK, komut çıktısındaki gereksiz gürültüyü filtreleyerek yalnızca önemli sinyalleri korur [bkz. .agents/rules/antigravity-rtk-rules.md](../.agents/rules/antigravity-rtk-rules.md).

---

## 3. Tasarım, Bileşenler & UI/UX

### S11. Neden HTML standart `<select>` etiketi kesinlikle yasaktır?
**Cevap:** Tarayıcının varsayılan `<select>` menüsü işletim sistemi tarafından çizilir; karanlık OLED temayla uyumsuzdur, arama kutusu barındıramaz, açılış animasyonu eklenemez ve mobilde estetik olmayan varsayılan gri/beyaz menüler çıkarır. Tüm seçimler için [`CustomSelect.tsx`](../koup-app/src/components/CustomSelect.tsx) zorunludur [bkz. 12-kurallar-ve-yasaklar.md#21-standart-select-etiketi-kesin-yasağı](./12-kurallar-ve-yasaklar.md#21-standart-select-etiketi-kesin-yasağı).

### S12. CustomSelect menüsü modal veya kart dışına taştığında nasıl görünür?
**Cevap:** `CustomSelect` varsayılan olarak `portal={true}` moduyla çalışır (`createPortal`). Menü doğrudan `document.body` üzerine render edildiğinden, üst ebeveyn konteynerdeki `overflow: hidden` kuralı tarafından asla kırpılmaz ve ekrandaki koordinatları dinamik hesaplanır [bkz. 04-bilesenler-ve-tasarim-sistemi.md](./04-bilesenler-ve-tasarim-sistemi.md).

### S13. Hover Akordiyon Genişlemesi (`AccordionMediaCard`) nasıl çalışır?
**Cevap:** Yatay medya listelerindeki dikey 2:3 afiş kartları, fare üzerine geldiğinde yay fiziğiyle 16:9 sinematik sahne kartına genişler. Kart içinde otomatik arka plan videosu veya fragman sessiz oynatılır, tür rozetleri ve hızlı eylem butonları gösterilir. Mobil dokunmatik ekranlarda ise kart doğrudan detay sayfasına gider [bkz. 04-bilesenler-ve-tasarim-sistemi.md](./04-bilesenler-ve-tasarim-sistemi.md).

### S14. Arayüzde neden aşırı metin (text-heavy) kullanımı yasaktır?
**Cevap:** KoUp sinematik bir streaming platformudur. Uzun açıklamalar kullanıcıyı yorar ve arayüzü amatör bir blog görünümüne iter. Bilgiler ikonlar, tipografik kontrast ve dengeli boşluklarla aktarılmalıdır [bkz. 12-kurallar-ve-yasaklar.md#22-aşırı-metin-text-heavy-ve-görsel-karmaşa-yasağı](./12-kurallar-ve-yasaklar.md#22-aşırı-metin-text-heavy-ve-görsel-karmaşa-yasağı).

### S15. Mobil cihazlarda tıklanabilir elemanların minimum boyutu ne olmalıdır?
**Cevap:** Parmak dokunma hedeflerinin ıskalanmaması ve kullanıcı deneyiminin bozulmaması için tüm buton ve tıklanabilir kontroller en az **44x44 piksel** alana sahip olmalıdır [bkz. 12-kurallar-ve-yasaklar.md#25-100-mobil-uyum-ve-44x44px-dokunma-hedefi](./12-kurallar-ve-yasaklar.md#25-100-mobil-uyum-ve-44x44px-dokunma-hedefi).

---

## 4. Oynatıcı (Player) & Video Akışı

### S16. Video açılmıyor veya siyah ekranda kalıyor, nereye bakmalıyım?
**Cevap:**
1. Tarayıcı Geliştirici Araçları (F12) > Ağ (Network) sekmesinde `/api/resolve-stream` veya `/api/stream-proxy` çağrısının durum kodunu inceleyin.
2. Kaynak sunucu HTTP 403 veya Cloudflare WAF engeli veriyorsa `stream-proxy` Referer başlıklarını kontrol edin.
3. Sağlayıcı iframe'i `X-Frame-Options: DENY` başlığı gönderiyorsa doğrudan HLS extraction yapılıp yapılmadığını denetleyin.
4. Konsolda Hls.js fatal error (`NETWORK_ERROR` veya `MEDIA_ERROR`) olup olmadığını kontrol edin [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

### S17. Oynatıcı neden bazen otomatik olarak bir sonraki kaynağa geçer (Fallback)?
**Cevap:** İlk seçilen video kaynağı 404/410 dosya silinmesi verirse, 429 Rate Limit'e takılırsa veya 10 saniye içinde oynatma başlatılamazsa, `NetflixPlayer` kullanıcıyı mağdur etmemek için otomatik olarak sıradaki çalışan yedek kaynağa (ör. Vidmoly'den OK.ru'ya veya Tau-Video'ya) geçer [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

### S18. `/api/stream-proxy` neden gereklidir ve ne iş yapar?
**Cevap:** Çoğu harici video sağlayıcısı (Vidmoly, Bunny CDN, Pichive vb.) doğrudan tarayıcıdan gelen isteklere CORS veya eksik Referer nedeniyle 403 Forbidden döner. `stream-proxy`, HLS manifest dosyasını (`.m3u8`) sunucu üzerinden çeker, içindeki alt segment linklerini (`.ts`, `.dts`) proxy üzerinden akacak şekilde yeniden yazar ve doğru Origin/Referer başlıklarını ekler [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

### S19. `/api/image-proxy` neden kullanılır ve afişler neden doğrudan gösterilmez?
**Cevap:**
1. Bazı kazıyıcı kaynak hostları dışarıdan doğrudan resim çekilmesine izin vermez (Hotlink koruması / 403).
2. SVG tabanlı XSS açıklarını önlemek için `Content-Security-Policy: default-src 'none'; sandbox` başlığı basar.
3. Görselleri `sharp` ile WebP formatına sıkıştırıp boyutlandırarak bant genişliğinden tasarruf sağlar ve LCP süresini düşürür [bkz. 06-api-referansi.md](./06-api-referansi.md).

### S20. Dikey kısa dramalarda (Shorts) oynatıcı nasıl davranır?
**Cevap:** `NetflixPlayer` `variant="vertical"` prop'u aldığında yatay sinematik kontroller küçülür; dikey 9:16 ekranda taşmayı önlemek için dahili "Bölümler" popover'ı gizlenir (çünkü Shorts sayfasında sağda/altta ayrı bölüm çekmecesi vardır) ve dikey kaydırma jestlerine duyarlı hale gelir [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

### S21. İntroyu Atla (+85s) butonu nasıl çalışır?
**Cevap:** Bölüm başladıktan sonra ilk 90 saniye boyunca sağ alt köşede "İntroyu Atla" butonu belirir. Tıklandığında video süresini doğrudan +85 saniye ileri sarar ve buton kaybolur [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

---

## 5. Veri Katmanı, Arşiv & Senkronizasyon

### S22. Arşivde (SQLite) bir veri düzelttim, sitede neden görünmüyor?
**Cevap:** Çünkü KoUp tam senkronizasyon zinciri kuralına bağlıdır. Yerel `webdrama_archive.db` üzerinde yapılan değişiklikler Cloudflare R2'ye ve Supabase'e yansıtılmamıştır. Şu 3 adımı çalıştırmalısınız:
1. `scripts/export_sources_bundles.py --id <MEDIA_ID>` (R2 JSON paketini oluşturun).
2. `scripts/upload_to_r2.py --ids-file <DOSYA>` (R2'ye yükleyin).
3. `scripts/sync_all_episodes_to_supabase.py --id <MEDIA_ID>` (Supabase'i güncelleyin) [bkz. 09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md).

### S23. Neden Supabase'e bölüm başına sadece 2-3 kaynak yazılıyor?
**Cevap:** Supabase PostgreSQL depolama kotasını (500MB) korumak ve istemci sorgu hızını maksimize etmek için bölüm başına yalnızca en yüksek kaliteli ve sağlam 2-3 benzersiz kaynak (ör. Vidmoly 1080p, Tau-Video) Supabase `episodes.sources` sütununa yazılır. Kalan 10+ kaynak alternatifi Cloudflare R2 üzerindeki JSON dosyasında eksiksiz saklanır [bkz. 08-veri-katmani.md](./08-veri-katmani.md).

### S24. Yeni bir dizi veya bölüm kazıyıcısı (scraper) nasıl çalıştırılır?
**Cevap:**
- Belirli bir dizi için tüm bağlı siteleri taramak: `python scripts/series_automation_runner.py --id <MEDIA_ID>`
- Tüm aktif güncel serileri taramak: `python scripts/series_automation_runner.py --all-active`
- Canlı kaynak taraması: `python scrapers/live_scanner.py` [bkz. 09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md).

### S25. TMDB zenginleştirmesi orijinal afiş veya başlığı ezebilir mi?
**Cevap:** Kesinlikle HAYIR! Kısa dramalar, web dramalar ve Asya animelerinin orijinal afişleri kazıyıcıdan, AniList'ten veya MyDramaList'ten gelir. TMDB otomatik zenginleştirmesi (`auto-enrich`) mevcut `cover_image` veya `title` alanını asla ezemez; yalnızca eksik olan fragman, arka plan görseli ve genel reyting bilgisini tamamlar [bkz. 12-kurallar-ve-yasaklar.md#52-orijinal-afiş-ve-metadata-koruma-kuralı](./12-kurallar-ve-yasaklar.md#52-orijinal-afiş-ve-metadata-koruma-kuralı).

### S26. SQLite veritabanı yedeği R2'ye nasıl alınır?
**Cevap:** `scrapers/supabase_sync_helper.py` içerisindeki `backup_db_to_r2()` fonksiyonu çağrılır. Bu fonksiyon SQLite'ta `PRAGMA wal_checkpoint(FULL)` çalıştırarak tüm veriyi tek bir dosyaya indirger ve R2 üzerindeki `db/webdrama_archive.db` konumuna yükler [bkz. 09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md).

---

## 6. Güvenlik, Kimlik Doğrulama & İzinler

### S27. Gizli anahtarlarımı yanlışlıkla koda yazarsam ne olur?
**Cevap:** Kod GitHub'a pushlandığında gizli anahtarlar anında sızdırılmış olur. Özellikle `SUPABASE_SERVICE_ROLE_KEY` çalınırsa saldırgan tüm veritabanı RLS korumalarını bypass edebilir. Tüm anahtarlar yalnızca `.env.local` dosyasında tutulmalıdır [bkz. 12-kurallar-ve-yasaklar.md#31-kaynak-koda-gizli-anahtar-gömme-yasağı-zero-hardcoded-secrets](./12-kurallar-ve-yasaklar.md#31-kaynak-koda-gizli-anahtar-gömme-yasağı-zero-hardcoded-secrets).

### S28. Kullanıcı rolü (`admin`/`moderator`) nerede doğrulanır?
**Cevap:** Kullanıcı rolü **ASLA** istemci tarafında (`localStorage`, çerez veya context state'i) sorgulanarak yetki verilmez. Sunucu tarafında `adminAuth.ts` dosyasındaki `verifyAdminAuth(req)` fonksiyonu, gelen oturum token'ını Supabase Auth ile çözer ve veritabanındaki `profiles.role` sütunundan doğrudan sorgular [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

### S29. Bir kullanıcıyı sistemden nasıl yasaklarız (Hard Ban)?
**Cevap:** Admin panelinden veya veritabanından kullanıcının `profiles.is_banned` değeri `true` yapılır. Ek olarak kötü niyetli saldırılarda [`fingerprint.ts`](../koup-app/src/lib/fingerprint.ts) ile cihaz parmak izi ve IP adresi kara listeye (`banned_devices` tablosu) alınarak yeni hesap açması engellenir [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

### S30. SSRF açığı nedir ve KoUp bunu nasıl engeller?
**Cevap:** Saldırganın proxy uçlarına yerel IP (127.0.0.1, 192.168.x.x) veya bulut metadata adresleri (169.254.169.254) vererek sunucu içi hassas bilgilere erişmesidir. KoUp `stream-proxy` ve `image-proxy` rotalarında IP/host filtrelemesi ve DNS çözümleme kontrolü ile bu istekleri anında reddeder [bkz. 12-kurallar-ve-yasaklar.md#32-ssrf-server-side-request-forgery-koruma-kuralları](./12-kurallar-ve-yasaklar.md#32-ssrf-server-side-request-forgery-koruma-kuralları).

### S31. Supabase Advisor denetiminde çıkan uyarılar (WARN / INFO) neden onarılmalıdır?
**Cevap:** `search_path` tanımlanmamış fonksiyonlar güvenlik açıklarına, indekslenmemiş Foreign Key'ler ise veritabanı büyüdükçe kilitlenmelere ve performans düşüşlerine yol açar. KoUp standartlarına göre tüm Advisor bulguları migration dosyalarıyla fixlenmelidir [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

---

## 7. Yönetim Paneli & Moderasyon

### S32. Admin paneline (`/admin`) nasıl erişilir?
**Cevap:** Giriş yaptıktan sonra `profiles` tablosunda `role` değeri `'admin'` veya `'moderator'` olan kullanıcılar `/admin` rotasına erişebilir. Yetkisi olmayanlar yüksek güvenlikli 403 Forbidden ekranıyla karşılaşır [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

### S33. Yerel geliştirmede admin paneline bypass ile girilebilir mi?
**Cevap:** Yalnızca yerel ortamda (`NODE_ENV === 'development'`), Vercel veya Cloudflare ortamında OLMAMAK şartıyla, `.env.local` içine `ADMIN_DEV_BYPASS=1` tanımlandığında test amaçlı admin bypass oturumu açılabilir [bkz. koup-app/src/lib/adminAuth.ts#L124-L131](../koup-app/src/lib/adminAuth.ts#L124-L131).

### S34. Küfürlü veya uygunsuz yorumlar nasıl denetlenir?
**Cevap:** Yorumlar girildiğinde otomatik anahtar kelime filtresinden geçer. Şüpheli yorumlar `is_approved = false` olarak işaretlenir ve admin panelindeki "Yorum Moderasyonu" sekmesinden onaylanana veya silinene kadar diğer kullanıcılara gösterilmez [bkz. 10-kullanici-ozellikleri.md](./10-kullanici-ozellikleri.md).

### S35. Sistem duyurusu (Broadcast Bildirim) nasıl gönderilir?
**Cevap:** Admin panelindeki Bildirim Yönetimi alanından oluşturulan duyurular, `send_broadcast_notification` SECURITY DEFINER SQL fonksiyonu ile tüm aktif kullanıcıların bildirim merkezine anlık olarak düşürülür [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

---

## 8. Dağıtım (Deploy), Ağ & Cloudflare

### S36. Vercel üzerinde derleme (build) sırasında TypeScript hataları build'i durdurur mu?
**Cevap:** [`next.config.mjs`](../koup-app/next.config.mjs#L66-L71) içinde acil dağıtımların kilitlenmemesi için `typescript: { ignoreBuildErrors: true }` ve `eslint: { ignoreDuringBuilds: true }` tanımlıdır. Ancak yerel geliştirmede ve PR aşamasında `npx tsc --noEmit` hatasız geçmek zorundadır [bkz. 02-kurulum-ortam-ve-deploy.md](./02-kurulum-ortam-ve-deploy.md).

### S37. Cloudflare Worker hangi görevleri üstlenir?
**Cevap:** `cloudflare/worker.js`, Vercel sunucusuna yük bindirmemek için video akışlarının çözümleme ve HLS manifest manipülasyonunu, Referer sahtelemesini ve R2 üzerindeki bundle paketlerinin edge seviyesinde yüksek hızla sunulmasını yönetir [bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md).

### S38. Next.js görsel optimizasyonu (`images.unoptimized: true`) neden devre dışıdır?
**Cevap:** KoUp arşivinde 17.000+ yapıma ait yüz binlerce harici afiş ve bölüm görseli bulunmaktadır. Next.js varsayılan sunucu optimizasyonu bu görselleri Vercel sunucusunda dönüştürmeye çalışırsa CPU ve bellek darboğazına girer ve maliyet fırlar. Görseller özel `/api/image-proxy` veya doğrudan R2 CDN üzerinden sunulur [bkz. 02-kurulum-ortam-ve-deploy.md](./02-kurulum-ortam-ve-deploy.md).

### S39. Güvenlik başlıkları (Security Headers) nerede yapılandırılır?
**Cevap:** [`next.config.mjs`](../koup-app/next.config.mjs#L26-L64) dosyasında tüm rotalar için `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` ve `Content-Security-Policy: frame-ancestors 'self'` başlıkları otomatik eklenir [bkz. 07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md).

---

## 9. Dokümantasyon & Proje Kuralları

### S40. Yeni bir sayfa, API ucu veya özellik eklediğimde ne yapmalıyım?
**Cevap:** Kod geliştirmesi tamamlandıktan sonra [`14-dokumantasyon-rehberi.md`](./14-dokumantasyon-rehberi.md) içindeki eşleme tablosuna bakarak ilgili doküman dosyasını (ör. yeni API için `06-api-referansi.md`) güncellemeli ve [`CHANGELOG.md`](./CHANGELOG.md) dosyasına yapılan değişikliği işlemelisiniz. Dokümantasyon güncellenmeden görev tamamlanmış sayılmaz [bkz. GEMINI.md §12](../GEMINI.md).

### S41. Dokümanlarda neden API anahtarları veya gerçek token'lar yer almaz?
**Cevap:** Kesin güvenlik kuralı gereğidir (Zero Hardcoded Secrets). Dokümanlarda yalnızca ortam değişkeni isimleri (`SUPABASE_URL`, `R2_ACCESS_KEY` vb.) yazılır; gerçek değerler asla dokümanlara yazılamaz [bkz. 14-dokumantasyon-rehberi.md](./14-dokumantasyon-rehberi.md).

### S42. Bir özellik test edilmeden "tamamlandı" denebilir mi?
**Cevap:** Kesinlikle HAYIR! KoUp kurallarında "No Fake Success" ilkesi geçerlidir. Tip kontrolü (`tsc`), canlı HTTP istek testi ve mobil uyum kontrolleri terminal ve tarayıcıda doğrulanmadan hiçbir özellik tamamlandı kabul edilemez [bkz. 12-kurallar-ve-yasaklar.md#64-100-dürüstlük-ve-doğrulama-no-fake-success](./12-kurallar-ve-yasaklar.md#64-100-dürüstlük-ve-doğrulama-no-fake-success).

### S43. Subagent'lar neden doğrudan kod düzenlemeye başlayamaz?
**Cevap:** Ana Ajan bir yönetici ve orkestratördür. Görevleri ilgili uzman alt ajanlara (frontend-squad, backend-squad, db-supabase-squad vb.) delege eder ve her ajana görevin büyük resmini, takım arkadaşlarını ve kilitli dosya sınırlarını aktarır [bkz. 12-kurallar-ve-yasaklar.md#72-alt-ajan-brifinginde-büyük-resim-ve-takım-görünürlüğü](./12-kurallar-ve-yasaklar.md#72-alt-ajan-brifinginde-büyük-resim-ve-takım-görünürlüğü).

### S44. Doküman dosyaları arasındaki bağlantılar nasıl kurulmalıdır?
**Cevap:** Doküman içi çapraz bağlantılar kesinlikle göreli link formatında verilmelidir (ör. `[bkz. 05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md)` veya proje dosyası için `[NetflixPlayer.tsx](../koup-app/src/components/NetflixPlayer.tsx)`). Uydurma çapa linklerinden kaçınılmalıdır [bkz. 14-dokumantasyon-rehberi.md](./14-dokumantasyon-rehberi.md).

### S45. Canlı katalog denetiminde (Catalog Audit) bulunan ölü linkler nasıl raporlanır?
**Cevap:** [`audit_reports/MASTER_CATALOG_AUDIT.md`](../audit_reports/MASTER_CATALOG_AUDIT.md) dosyasında 24.238 yapım ve 573.809 kaynak taranmış ve kategorilerine göre ölü link, zaman aşımı ve eksik bölüm raporları detaylandırılmıştır. Onarım işlemleri bu rapor rehberliğinde yürütülür [bkz. 09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md).

---

## 10. İlgili Dokümanlar
- [README.md](./README.md) — Dokümantasyon Ana Dizini ve Okuma Sırası
- [01-genel-bakis-ve-mimari.md](./01-genel-bakis-ve-mimari.md) — Sistem Mimarisi
- [05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md) — Video Akış Detayları
- [07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md) — Güvenlik Standartları
- [09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md) — Arşiv ve Senkronizasyon
- [12-kurallar-ve-yasaklar.md](./12-kurallar-ve-yasaklar.md) — Proje Kuralları ve Yasaklar
- [14-dokumantasyon-rehberi.md](./14-dokumantasyon-rehberi.md) — Dokümantasyon Güncelleme Rehberi
