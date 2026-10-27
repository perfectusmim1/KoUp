# 02 — Kurulum, Ortam Değişkenleri ve Deploy Rehberi

Bu doküman; KoUp platformunun yerel geliştirme ortamında sıfırdan kurulumunu, tüm ortam değişkenlerinin (environment variables) görev ve güvenlik kapsamlarını, Vercel ve Cloudflare dağıtım (deploy) süreçlerini, GitHub Actions otomasyonlarını ve operasyonel kuralları adım adım açıklamaktadır.

---

## İçindekiler
- [1. Ön Koşullar](#1-ön-koşullar)
- [2. Yerel Kurulum Adımları](#2-yerel-kurulum-adımları)
  - [2.1 Web Uygulaması (Next.js) Kurulumu](#21-web-uygulaması-nextjs-kurulumu)
  - [2.2 Python Kazıma ve Otomasyon Katmanı Kurulumu](#22-python-kazıma-ve-otomasyon-katmanı-kurulumu)
  - [2.3 Yerel SQLite Veritabanı ve Arşiv Hazırlığı](#23-yerel-sqlite-veritabanı-ve-arşiv-hazırlığı)
- [3. Ortam Değişkenleri Referans Tablosu](#3-ortam-değişkenleri-referans-tablosu)
  - [3.1 Değişkenler Tablosu (Tam Liste)](#31-değişkenler-tablosu-tam-liste)
  - [3.2 NEXT\_PUBLIC\_ Güvenlik Prensibi (Public vs Private İzolasyonu)](#32-next_public_-güvenlik-prensibi-public-vs-private-izolasyonu)
- [4. Yapılandırma Dosyaları](#4-yapılandırma-dosyaları)
  - [4.1 next.config.mjs Yapılandırması](#41-nextconfigmjs-yapılandırması)
  - [4.2 vercel.json Yapılandırması](#42-verceljson-yapılandırması)
  - [4.3 tsconfig.json Path Alias Yapısı](#43-tsconfigjson-path-alias-yapısı)
- [5. Bulut Dağıtımları (Deployments)](#5-bulut-dağıtımları-deployments)
  - [5.1 Vercel Frontend Dağıtımı & sync\_vercel\_env.py](#51-vercel-frontend-dağıtımı--sync_vercel_envpy)
  - [5.2 Cloudflare Worker & R2 Dağıtımı](#52-cloudflare-worker--r2-dağıtımı)
  - [5.3 GitHub Actions Bulut Otomasyonları (.github/workflows)](#53-github-actions-bulut-otomasyonları-githubworkflows)
- [6. Geliştirme, Tip Kontrolü ve Operasyonel Kurallar](#6-geliştirme-tip-kontrolü-ve-operasyonel-kurallar)
  - [6.1 NPM Scriptleri](#61-npm-scriptleri)
  - [6.2 Tip Güvenliği Doğrulaması (tsc --noEmit)](#62-tip-güvenliği-doğrulaması-tsc---noemit)
  - [6.3 Geliştirme Sunucusu (Dev Server) Disiplini ve Yasaklar](#63-geliştirme-sunucusu-dev-server-disiplini-ve-yasaklar)
- [7. İlgili Dokümanlar](#7-ilgili-dokümanlar)

---

## 1. Ön Koşullar

KoUp projesini yerel makinenizde çalıştırmak ve tüm alt sistemleri yönetebilmek için aşağıdaki çalışma ortamlarının kurulu olması gerekir:

1. **Node.js:** `v20.x LTS` veya `v22.x LTS` (Projedeki `@types/node` sürümü: `^22.13.5`).
2. **Paket Yöneticisi:** `npm` (v10+), `pnpm` (v9+) veya `yarn`.
3. **Python:** `v3.12.x` (GitHub Actions runnerları ve yerel otomasyon betikleri Python 3.12 için optimize edilmiştir).
4. **Git:** v2.40+ (Monorepo ve submodule/versiyon takibi için).
5. **SQLite CLI (Opsiyonel):** `sqlite3` komut satırı aracı (yerel `webdrama_archive.db` incelemeleri için).

---

## 2. Yerel Kurulum Adımları

### 2.1 Web Uygulaması (Next.js) Kurulumu

Depoyu yerel bilgisayarınıza klonlayın ve web uygulaması dizinine geçin:

```bash
git clone https://github.com/perfectusmim1/KoUp.git
cd KoUp/koup-app
```

Bağımlılıkları yükleyin:

```bash
npm install
```

Ortam değişkenleri dosyasını oluşturun:

```bash
cp .env.example .env.local
```

`.env.local` dosyasını bir metin düzenleyiciyle açıp gerekli Supabase, R2 ve TMDB anahtarlarını girin (ayrıntılar için [Bölüm 3](#3-ortam-değişkenleri-referans-tablosu)).

---

### 2.2 Python Kazıma ve Otomasyon Katmanı Kurulumu

Proje kökünde (`KoUp/`), kazıyıcılar ve senkronizasyon araçları için gereken Python paketlerini kurun:

```bash
cd ..
# Sanal ortam oluşturma (Önerilir)
python -m venv venv

# Windows üzerinde sanal ortamı aktive etme:
.\venv\Scripts\activate

# Linux / macOS üzerinde:
source venv/bin/activate
```

Gerekli harici paketleri yükleyin:

```bash
pip install requests beautifulsoup4 curl_cffi boto3 cryptography python-dotenv aiohttp
```

> [!NOTE]
> Projede statik bir `requirements.txt` bulunmamaktadır; yukarıdaki paket listesi doğrudan `.github/workflows/` ve `scrapers/` kaynak kodlarındaki bağımlılıklardan derlenmiştir.

---

### 2.3 Yerel SQLite Veritabanı ve Arşiv Hazırlığı

KoUp'ın yerel arşivi `webdrama_archive.db` adıyla proje kökünde yer alır.
- Eğer repo içinde mevcut değilse, Cloudflare R2 üzerinden indirilebilir:
```bash
python -c "from scrapers.supabase_sync_helper import download_db_from_r2; download_db_from_r2('webdrama_archive.db')"
```
- Veritabanı bağlantısı ve WAL (Write-Ahead Logging) modunu test etmek için:
```bash
python -c "import database; conn = database.get_connection(); print('SQLite WAL Bağlantısı Başarılı!'); conn.close()"
```

---

## 3. Ortam Değişkenleri Referans Tablosu

### 3.1 Değişkenler Tablosu (Tam Liste)

Aşağıdaki tablo, `koup-app` kaynak kodlarında (`process.env.*`), Python araçlarında (`os.environ` / `os.getenv`), Cloudflare Worker'da ve GitHub Actions iş akışlarında kullanılan **tüm** ortam değişkenlerini listeler.

| Değişken Adı | Kullanıldığı Dosyalar | Kapsam (İstemci / Sunucu) | Zorunlu mu? | Ne İşe Yarar? (Açıklama) |
| :--- | :--- | :--- | :--- | :--- |
| **`NEXT_PUBLIC_SUPABASE_URL`** | `koup-app/src/lib/supabase.ts`, `scrapers/supabase_sync_helper.py`, `.github/workflows/*.yml` | İstemci & Sunucu | **Evet** | Supabase projesinin genel API kök URL adresi (`https://<project-id>.supabase.co`). |
| **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** | `koup-app/src/lib/supabase.ts`, `scripts/sync_vercel_env.py` | İstemci & Sunucu | **Evet** | İstemci tarafı anonim erişim anahtarı. PostgreSQL Row Level Security (RLS) kurallarına tabidir. |
| **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** | `koup-app/src/lib/supabase.ts`, `scripts/sync_vercel_env.py` | İstemci & Sunucu | Hayır | Supabase yeni standartlarında anon key alternatifi/alias'ı. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | `koup-app/src/lib/supabase.ts`, `koup-app/src/lib/adminAuth.ts`, `scrapers/*.py`, `.github/workflows/*.yml` | **Sunucu Yalnızca (Gizli)** | **Evet** | RLS politikalarını baypas eden tam yetkili veritabanı yönetici anahtarı. Asla istemciye verilmez. |
| **`SUPABASE_SECRET_KEY`** | `koup-app/src/lib/supabase.ts`, `scrapers/supabase_sync_helper.py` | Sunucu Yalnızca | Hayır | `SUPABASE_SERVICE_ROLE_KEY` için geriye dönük uyumluluk alias'ı. |
| **`CF_R2_ACCESS_KEY_ID`** | `lib/server/seriesData.ts`, `api/sources/[mediaId]`, `scrapers/supabase_sync_helper.py`, `.github/workflows/*.yml` | **Sunucu Yalnızca (Gizli)** | **Evet** | Cloudflare R2 S3 uyumlu nesne depolama erişim anahtarı ID'si. |
| **`CF_R2_SECRET_ACCESS_KEY`** | `lib/server/seriesData.ts`, `api/sources/[mediaId]`, `scrapers/supabase_sync_helper.py`, `.github/workflows/*.yml` | **Sunucu Yalnızca (Gizli)** | **Evet** | Cloudflare R2 S3 uyumlu gizli erişim anahtarı. |
| **`CF_R2_ENDPOINT`** | `lib/server/seriesData.ts`, `api/sources/[mediaId]`, `scrapers/supabase_sync_helper.py`, `.github/workflows/*.yml` | Sunucu Yalnızca | **Evet** | Cloudflare R2 S3 API uç noktası (`https://<account-id>.r2.cloudflarestorage.com`). |
| **`CF_R2_BUCKET`** | `lib/server/seriesData.ts`, `api/sources/[mediaId]`, `scripts/upload_to_r2.py` | Sunucu Yalnızca | Hayır | Hedef R2 bucket adı (Tanımlanmazsa varsayılan: `koup-archive`). |
| **`R2_PUBLIC_URL`** | `lib/server/seriesData.ts`, `api/sources/[mediaId]`, `scripts/upload_to_r2.py` | Sunucu Yalnızca | Hayır | Cloudflare R2 bucket'ının genel CDN web adresi (`https://pub-<id>.r2.dev`). |
| **`NEXT_PUBLIC_CF_WORKER_URL`**| `app/api/admin/catalog/route.ts`, `app/api/admin/maintenance/route.ts` | İstemci & Sunucu | Hayır | Cloudflare Edge Worker kök URL adresi (Varsayılan: `https://koup-edge-worker.caganhuseyinerdil.workers.dev`). |
| **`TMDB_API_KEY`** | `app/api/media/auto-enrich/route.ts`, `scrapers/*.py`, `scripts/*.py`, `.github/workflows/*.yml` | **Sunucu Yalnızca (Gizli)** | **Evet** | The Movie Database (TMDB) v3 API anahtarı. Dizi/film afişleri, özetler ve oyuncu verilerini çekmek için kullanılır. |
| **`NEXT_PUBLIC_TMDB_API_KEY`** | `scrapers/supabase_sync_helper.py`, `scripts/*.py` | Sunucu Yalnızca | Hayır | Python scriptlerinde `TMDB_API_KEY` bulunamadığında fallback olarak kontrol edilen alias. |
| **`ARCHIVE_DB_PATH`** | `app/api/sources/[mediaId]/route.ts`, `database.py`, `koup-app/.env.example` | Sunucu Yalnızca | Hayır | Yerel SQLite veritabanının dosya yolu (Varsayılan: `webdrama_archive.db` veya `../webdrama_archive.db`). |
| **`GITHUB_TOKEN`** / **`GH_TOKEN`** / **`GITHUB_PAT`** / **`GH_PAT`** | `koup-app/src/lib/server/scraperDispatch.ts`, `koup-app/src/lib/adminAuth.ts` | **Sunucu Yalnızca (Gizli)** | **Evet** | Vercel üzerindeki admin panelinden GitHub Actions işlerini (`admin_job.yml`) tetiklemek için gereken Kişisel Erişim Jetonu (PAT). `repo` ve `workflow` izinleri gereklidir. |
| **`GITHUB_REPO`** | `koup-app/src/lib/server/scraperDispatch.ts` | Sunucu Yalnızca | Hayır | GitHub Actions işlerinin tetiklendiği depo (Varsayılan: `perfectusmim1/KoUp`). |
| **`ADMIN_DEV_BYPASS`** | `koup-app/src/lib/adminAuth.ts` | Sunucu Yalnızca | Hayır | Yerel ortamda (`NODE_ENV === 'development'`) admin panelini şifresiz test etmek için `'1'` atanabilir. Üretimde kesinlikle kapalıdır. |
| **`PYTHON_BIN`** / **`PYTHON_PATH`** | `koup-app/src/lib/adminAuth.ts`, `app/api/mdl-import/route.ts` | Sunucu Yalnızca | Hayır | Yerel makinede çalıştırılacak Python binary yolunu belirtir (örn: `C:\Python312\python.exe`). |
| **`GIPHY_API_KEY`** | `koup-app/src/app/api/gifs/search/route.ts` | Sunucu Yalnızca | Hayır | Yorumlarda GIF arama özelliği için Giphy API anahtarı. |
| **`KOREDIZI_EMAIL`** & **`KOREDIZI_PASSWORD`** | `scrapers/sites/koredizi.py`, `.github/workflows/*.yml` | **Sunucu Yalnızca (Gizli)** | Koşullu | KoreDizi kaynağından veri çekilirken otomatik login olmak için kullanılan hesap bilgileri. |
| **`ANIMELVL_COOKIE`** / **`DIZIPAL_COOKIE`** / **`FULLHDFILMIZLESENE_COOKIE`** / **`SEZONLUKDIZI_COOKIE`** | `scrapers/sites/*.py` | Sunucu Yalnızca | Hayır | İlgili sağlayıcıların Cloudflare Turnstile/Clearance korumasını aşmak için sağlanan oturum çerezleri. |
| **`CF_ACCOUNT_ID`** & **`CF_API_TOKEN`** | `scripts/sync_vercel_env.py` | Sunucu Yalnızca | Hayır | Cloudflare REST API ile Vercel ve Worker ortam senkronizasyonu için kullanılır. |
| **`ARCHIVE_BUCKET`** (Worker Binding) | `cloudflare/worker.js` | Cloudflare Edge Binding | **Evet** | Cloudflare Worker'ın R2 bucket'ına doğrudan JavaScript API'si (`env.ARCHIVE_BUCKET.get()`) ile erişmesini sağlayan binding. |
| **`R2_SECRET`** | `cloudflare/worker.js` | Cloudflare Edge Secret | **Evet** | Worker üzerinden `/archive/{key}` yoluna `PUT`/`POST` ile JSON yüklenirken kontrol edilen Bearer token. |

---

### 3.2 NEXT_PUBLIC_ Güvenlik Prensibi (Public vs Private İzolasyonu)

Next.js mimarisinde ortam değişkenleri iki temel kategoriye ayrılır:

1. **`NEXT_PUBLIC_` İstemci Değişkenleri (Browser Bundle'a Gömülenler):**
   - Next.js, derleme (build) sırasında `NEXT_PUBLIC_` önekine sahip tüm değişkenlerin değerlerini istemci JavaScript kodunun içine düz metin olarak yerleştirir (inline replacement).
   - Tarayıcının Kaynaklar (Sources) veya Ağ (Network) sekmesini açan herkes bu değerleri açıkça görebilir.
   - **Neden Güvenlidir?** `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY`, Supabase mimarisinde zaten açık olması gereken genel uç noktalardır. Veri tabanının güvenliği anahtarla değil, PostgreSQL tarafındaki **Row Level Security (RLS)** politikalarıyla sağlanır.

2. **Gizli Sunucu Değişkenleri (Asla NEXT_PUBLIC_ Yapılamaz):**
   - `SUPABASE_SERVICE_ROLE_KEY`, `CF_R2_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `TMDB_API_KEY` gibi değişkenler `NEXT_PUBLIC_` **kesinlikle yapılamaz**.
   - `SUPABASE_SERVICE_ROLE_KEY`, veritabanındaki tüm RLS korumalarını atlayarak tablolara tam okuma, yazma ve silme hakkı verir. İstemciye sızması halinde tüm kullanıcı verileri ve veritabanı çalınabilir veya silinebilir.
   - Bu anahtarlar yalnızca sunucu tarafında (`koup-app/src/lib/server/*`, API route handler'ları veya Python betikleri) `process.env.*` üzerinden okunur ve istemciye asla iletilmez.

---

## 4. Yapılandırma Dosyaları

### 4.1 next.config.mjs Yapılandırması
Dosya: [koup-app/next.config.mjs](../koup-app/next.config.mjs)

- **`compress: true`:** Gzip ve Brotli sıkıştırmasını aktif ederek sunucu yanıt boyutunu minimize eder.
- **`poweredByHeader: false`:** Güvenlik amacıyla `X-Powered-By: Next.js` HTTP başlığını kaldırarak sunucu altyapısını gizler.
- **`images.unoptimized: true`:** 17.000'den fazla yapımın dış kaynaklı kapak ve sahne afişleri bulunmaktadır. Next.js görsel optimizasyon motorunun sunucu CPU ve belleğini tüketmesini engellemek için görseller doğrudan CDN üzerinden sunulur.
- **`images.remotePatterns`:** Tüm HTTP ve HTTPS kaynaklı dış afiş URL'lerine izin verir (`hostname: '**'`).
- **`redirects()`:** Eski `/son-eklenen-bolumler` URL'sini kalıcı (301) olarak `/son-eklenenler` rotasına yönlendirir.
- **`headers()` (Güvenlik Başlıkları):**
  - `X-Content-Type-Options: nosniff` (MIME türü manipülasyonunu engeller).
  - `X-Frame-Options: SAMEORIGIN` (Clickjacking saldırılarına karşı siteyi korur).
  - `Referrer-Policy: strict-origin-when-cross-origin` (Dış sitelere sadece domain bilgisini aktarır).
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()` (Tarayıcı donanım erişimlerini kapatır).
  - `Content-Security-Policy: frame-ancestors 'self';` (Sitenin yetkisiz iframe içine gömülmesini engeller).
  - `/api/image-proxy` için `Cache-Control: public, max-age=2592000, immutable` (30 gün tarayıcı/CDN önbelleği).
- **`eslint` & `typescript` ignore settings:** Build aşamasında tip veya lint uyarılarının dağıtımı (deploy) durdurmasını engeller; tip kontrolleri yerel ortamda `npx tsc --noEmit` ile yapılır.

---

### 4.2 vercel.json Yapılandırması
Dosya: [koup-app/vercel.json](../koup-app/vercel.json)

```json
{
  "regions": ["fra1"]
}
```

- **`regions: ["fra1"]`:** Vercel Serverless Function'larının Frankfurt (Almanya) veri merkezinde çalışmasını sağlar. Türkiye ve çevre coğrafyadaki kullanıcılar için en düşük gidiş-dönüş süresini (RTT / Ping) sunar.

---

### 4.3 tsconfig.json Path Alias Yapısı
Dosya: [koup-app/tsconfig.json](../koup-app/tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- `@/*` alias'ı, `koup-app/src/` dizini altına işaret eder. Bu sayede derin klasör yapılarında `../../../components/` gibi kırılgan göreli yollar yerine `@/components/NetflixPlayer` veya `@/lib/supabase` şeklinde modüler importlar kullanılır.

---

## 5. Bulut Dağıtımları (Deployments)

### 5.1 Vercel Frontend Dağıtımı & sync_vercel_env.py

KoUp ön yüzü Vercel üzerinde barındırılır.

#### Ortam Değişkenlerinin Vercel'e Senkronizasyonu (`sync_vercel_env.py`)
Yerel `.env.local` dosyasındaki değişkenleri Vercel projesine tek tek elle girmek yerine, projedeki [scripts/sync_vercel_env.py](../scripts/sync_vercel_env.py) aracı kullanılır:

```bash
python scripts/sync_vercel_env.py
```

**Nasıl Çalışır?**
1. `koup-app/.env.local` dosyasını ayrıştırır.
2. Senkronize edilecek anahtarları (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CF_R2_*`, `TMDB_API_KEY` vb.) filtreler.
3. `NEXT_PUBLIC_` ile başlayan değişkenleri Vercel'e `--no-sensitive` bayrağıyla ekler.
4. Gizli servis anahtarlarını Vercel'e `--sensitive` bayrağıyla şifrelenmiş olarak ekler.
5. Vercel CLI (`npx -y vercel env add ... --force --yes`) komutunu çalıştırarak Production, Preview ve Development ortamlarına otomatik işler.

---

### 5.2 Cloudflare Worker & R2 Dağıtımı

Cloudflare Worker (`cloudflare/worker.js`), video streamlerinin çözülmesi ve R2 nesne depolaması köprüsü için kullanılır:

- **Worker URL:** `https://koup-edge-worker.caganhuseyinerdil.workers.dev`
- **Uç Noktalar:**
  - `/magazin`: AsyaMag WordPress REST API'sini edge üzerinde önbelleğe alır.
  - `/tau`: Tau-Video API stream extractor.
  - `/pichive`: Pichive / AsyaWatch iframe ve `source2.php` token çözümleyicisi.
  - `/pichive-proxy`: HLS m3u8 playlistlerini dinamik olarak rewrite eder ve TS parçalarını proxy'ler.
  - `/resolve`: Vidmoly, Sibnet ve Ok.ru stream bulucu.
  - `/archive/{key}`: R2 bucket'ından JSON paketlerini çeker (GET) veya Bearer secret doğrulamasıyla yeni paket yükler (PUT/POST).
- **R2 Bucket Binding Adı:** `ARCHIVE_BUCKET` (Cloudflare Dashboard > Workers > Settings > Variables > R2 Bucket Bindings altından yapılandırılır).
- **Worker Cron:** Her 30 dakikada bir otomatik tetiklenerek (`scheduled()`) popüler magazin akışlarını ısıtır.

---

### 5.3 GitHub Actions Bulut Otomasyonları (.github/workflows)

Projede üç adet GitHub Actions workflow'u tanımlıdır:

#### 1. KoUp Admin Dispatcher Job (`.github/workflows/admin_job.yml`)
- **Tetikleyici:** `workflow_dispatch` (Manuel veya Admin paneli `scraperDispatch.ts` üzerinden API ile).
- **Ne Yapar?**
  1. KoUp reposunu klonlar, Python 3.12 kurar.
  2. Cloudflare R2'den güncel SQLite veritabanını çeker (`download_db_from_r2`).
  3. Güvenli Allowlist içinde izin verilen Python scriptini (`live_scanner.py`, `series_automation_runner.py`, `cron_sync_pipeline.py` vb.) çalıştırır.
  4. İşlem bitiminde (hata alsa dahi `always()`) güncellenmiş SQLite veritabanını Cloudflare R2'ye geri yedekler (`backup_db_to_r2`).
- **Gereken GitHub Repository Secret İsimleri:**
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY`
  - `CF_R2_ENDPOINT`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET`
  - `KOREDIZI_EMAIL`, `KOREDIZI_PASSWORD`

#### 2. Multi-Site Scraper Cron (`.github/workflows/scraper_cron.yml`)
- **Tetikleyici:** `schedule` (Her 4 saatte bir: `0 */4 * * *`) ve `workflow_dispatch`.
- **Ne Yapar?**
  - `scripts/cron_sync_pipeline.py` scriptini çalıştırarak 9 sağlayıcıdaki yeni bölümleri tarar ve çözülememiş bekleyen kaynakları (`pending_sources`) otomatik tamamlar.

#### 3. Single Series Live Synchronizer (`.github/workflows/sync_single_series.yml`)
- **Tetikleyici:** `workflow_dispatch` (`drama_id`, `provider`, `manual_url` parametreleriyle).
- **Ne Yapar?**
  - Belirtilen tek bir yapımı hedef siteden anında tarar ve Supabase + R2 ile senkronize eder.

---

## 6. Geliştirme, Tip Kontrolü ve Operasyonel Kurallar

### 6.1 NPM Scriptleri

[koup-app/package.json](../koup-app/package.json) içinde tanımlı komutlar:

| Komut | Terminal Çağrısı | Açıklama |
| :--- | :--- | :--- |
| `npm run dev` | `next dev -p 3000` | Yerel geliştirme sunucusunu 3000 portunda başlatır. |
| `npm run build` | `next build` | Üretim derlemesini (production build) hazırlar. |
| `npm start` | `next start -p 3000` | Derlenmiş uygulamayı üretim modunda 3000 portunda sunar. |

---

### 6.2 Tip Güvenliği Doğrulaması (tsc --noEmit)

`next.config.mjs` içinde derleme hızını artırmak için `typescript.ignoreBuildErrors: true` tanımlanmıştır. Bu nedenle tip güvenliğini sağlamak için her değişiklikten sonra **mutlaka** şu komut çalıştırılmalıdır:

```bash
cd koup-app
npx tsc --noEmit
```

Bu komut herhangi bir `.js` çıktısı üretmez; projedeki tüm tipleri denetler ve olası tip uyuşmazlıklarını satır satır raporlar. Çıktının temiz (sıfır hata) olması zorunludur.

---

### 6.3 Geliştirme Sunucusu (Dev Server) Disiplini ve Yasaklar

> [!CAUTION]
> **Otonom Dev Server Başlatma Yasağı:**
> Geliştirme süreçlerinde veya yapay zeka alt ajanları tarafından **kendi kendine `npm run dev` başlatılması kesinlikle yasaktır.**

**Bu Yasağın Teknik Nedenleri:**
1. **Hayalet Süreçler (Ghost Processes):** Terminal oturumu kapansa bile arka planda çalışan Node.js süreçleri belleği (RAM) tüketmeye ve CPU harcamaya devam eder.
2. **Port Kilidi (Port Lock):** 3000 portu meşgul olduğunda Next.js otomatik olarak `3001` veya `3002` portuna geçer. Bu durum; sabit port bekleyen CORS kurallarını, OAuth/Auth callback URL'lerini ve yerel testleri bozar.
3. **`.next` Önbellek Bozulması (Cache Corruption):** `npm run dev` arka planda çalışırken aynı anda `next build` veya tip denetimi yapılması durumunda `.next/cache` dizinindeki derleme manifestleri kilitlenir ve bozulur (`Module not found`, hydration mismatch ve sahte 500 hataları oluşur).
4. **Çözüm:** Sunucu gerekiyorsa önce mevcut portun açık olup olmadığı kontrol edilir; tip doğrulaması için dev server yerine doğrudan `npx tsc --noEmit` kullanılır.

---

## 7. İlgili Dokümanlar
- [01 — Genel Bakış ve Mimari](./01-genel-bakis-ve-mimari.md)
- [06 — API Referansı](./06-api-referansi.md)
- [07 — Kimlik, Yetki ve Güvenlik](./07-kimlik-yetki-ve-guvenlik.md)
- [09 — Kazıyıcılar, Scriptler ve Senkronizasyon](./09-kaziyicilar-scriptler-ve-senkron.md)
- [12 — Kurallar ve Yasaklar](./12-kurallar-ve-yasaklar.md)
