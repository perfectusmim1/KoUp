# KoUp Proje Kuralları, Güvenlik Standartları ve Yasaklar (Rules & Prohibitions)

KoUp platformu; yüksek performanslı streaming, büyük ölçekli çok kaynaklı medya arşivi ve sinematik OLED arayüz sunan dağıtık bir sistemdir. Bu dokümanda yer alan kurallar, projedeki tüm geliştiriciler, otonom alt ajanlar ve katkıda bulunanlar için **kesinlikle ve tavizsiz uygulanması gereken zorunlu standartları** tanımlar.

---

## İçindekiler
1. [Kurallar ve Yasaklar Özet Matrisi](#1-kurallar-ve-yasaklar-özet-matrisi)
2. [Tasarım, Arayüz ve Kullanıcı Deneyimi Standartları](#2-tasarım-arayüz-ve-kullanıcı-deneyimi-standartları)
   - [2.1. Standart `<select>` Etiketi Kesin Yasağı](#21-standart-select-etiketi-kesin-yasağı)
   - [2.2. Aşırı Metin (Text-Heavy) ve Görsel Karmaşa Yasağı](#22-aşırı-metin-text-heavy-ve-görsel-karmaşa-yasağı)
   - [2.3. Sitenin Tasarım Dilinden Kopma Yasağı](#23-sitenin-tasarım-dilinden-kopma-yasağı)
   - [2.4. Akıcı Açılış/Kapanış Animasyonu Zorunluluğu](#24-akıcı-açılışkapanış-animasyonu-zorunluluğu)
   - [2.5. %100 Mobil Uyum ve 44x44px Dokunma Hedefi](#25-100-mobil-uyum-ve-44x44px-dokunma-hedefi)
3. [Güvenlik ve Kimlik Doğrulama Standartları](#3-güvenlik-ve-kimlik-doğrulama-standartları)
   - [3.1. Kaynak Koda Gizli Anahtar Gömme Yasağı (Zero Hardcoded Secrets)](#31-kaynak-koda-gizli-anahtar-gömme-yasağı-zero-hardcoded-secrets)
   - [3.2. SSRF (Server-Side Request Forgery) Koruma Kuralları](#32-ssrf-server-side-request-forgery-koruma-kuralları)
   - [3.3. XSS ve Güvenli HTML / SVG Render Standartları](#33-xss-ve-güvenli-html--svg-render-standartları)
   - [3.4. SQL Injection Koruması ve Parametreli Sorgular](#34-sql-injection-koruması-ve-parametreli-sorgular)
   - [3.5. IDOR (Insecure Direct Object Reference) Engelleme](#35-idor-insecure-direct-object-reference-engelleme)
   - [3.6. API Yetkilendirme, Katı Şema Doğrulama ve Rate-Limiting](#36-api-yetkilendirme-katı-şema-doğrulama-ve-rate-limiting)
   - [3.7. Supabase RLS ve Advisor (ERROR / WARN / INFO) Onarım Zorunluluğu](#37-supabase-rls-ve-advisor-error--warn--info-onarım-zorunluluğu)
4. [Performans, Veritabanı ve Bellek Standartları](#4-performans-veritabanı-ve-bellek-standartları)
   - [4.1. N+1 Sorgu ve Veritabanı Şişirme Yasağı](#41-n1-sorgu-ve-veritabanı-şişirme-yasağı)
   - [4.2. Core Web Vitals (CWV) Standartları](#42-core-web-vitals-cwv-standartları)
   - [4.3. 4 Kademeli Mobil Performans Benchmark Kuralı](#43-4-kademeli-mobil-performans-benchmark-kuralı)
   - [4.4. `useEffect` Bellek Sızıntısı ve Cleanup Zorunluluğu](#44-useeffect-bellek-sızıntısı-ve-cleanup-zorunluluğu)
5. [Arşiv Yönetimi ve Depolama Eşitleme Zinciri](#5-arşiv-yönetimi-ve-depolama-eşitleme-zinciri)
   - [5.1. Tam Arşiv Senkronizasyon Zinciri Zorunluluğu](#51-tam-arşiv-senkronizasyon-zinciri-zorunluluğu)
   - [5.2. Orijinal Afiş ve Metadata Koruma Kuralı](#52-orijinal-afiş-ve-metadata-koruma-kuralı)
6. [Geliştirme Ortamı, Terminal ve Git Disiplini](#6-geliştirme-ortamı-terminal-ve-git-disiplini)
   - [6.1. Durduk Yere Dev Server Başlatmama Disiplini](#61-durduk-yere-dev-server-başlatmama-disiplini)
   - [6.2. Temiz Git Commit ve Push Disiplini](#62-temiz-git-commit-ve-push-disiplini)
   - [6.3. Çalışma Alanı Temizliği ve Çöp Dosya Bırakmama](#63-çalışma-alanı-temizliği-ve-çöp-dosya-bırakmama)
   - [6.4. %100 Dürüstlük ve Doğrulama (No Fake Success)](#64-100-dürüstlük-ve-doğrulama-no-fake-success)
7. [Yaşayan Dokümantasyon ve Subagent Protokolleri](#7-yaşayan-dokümantasyon-ve-subagent-protokolleri)
   - [7.1. Yaşayan Dokümantasyon Zorunluluğu (GEMINI.md §12)](#71-yaşayan-dokümantasyon-zorunluluğu-geminimd-12)
   - [7.2. Alt Ajan Brifinginde Büyük Resim ve Takım Görünürlüğü](#72-alt-ajan-brifinginde-büyük-resim-ve-takım-görünürlüğü)
8. [İlgili Dokümanlar](#8-ilgili-dokümanlar)

---

## 1. Kurallar ve Yasaklar Özet Matrisi

| Kural Kodu | Kategori | Kural Adı | Ciddiyet | İlgili Dosyalar & Konumlar |
| :--- | :--- | :--- | :---: | :--- |
| **R-UI-01** | UI / UX | Standart `<select>` Kullanım Yasağı | 🔴 KRİTİK | `koup-app/src/components/CustomSelect.tsx` |
| **R-UI-02** | UI / UX | Aşırı Metin ve Görsel Kalabalık Yasağı | 🟠 YÜKSEK | Tüm `src/app/**/page.tsx` ve bileşenler |
| **R-UI-03** | UI / UX | Lumina OLED Tasarım Dilinden Kopma Yasağı | 🟠 YÜKSEK | `src/app/globals.css`, Tailwind sınıfları |
| **R-UI-04** | UI / UX | Akıcı Açılış/Kapanış Animasyonu Zorunluluğu | 🟡 ORTA | `motion/react`, `AnimatePresence` |
| **R-UI-05** | UI / UX | %100 Mobil Uyum ve 44x44px Dokunma Hedefi | 🔴 KRİTİK | Mobil navigasyon, butonlar, drawer'lar |
| **R-UI-06** | UI / UX | %100 Dil Uyumu ve Site Dili Bütünlüğü | 🔴 KRİTİK | Tüm arayüz bileşenleri, etiketler ve metinler |
| **R-SEC-01** | Güvenlik | Sıfır Hardcoded Secret & `NEXT_PUBLIC_` İzolasyonu | 🔴 KRİTİK | `.env.local`, `.env`, API rotaları, `lib/` |
| **R-SEC-02** | Güvenlik | SSRF Koruması & Whitelist/Dns Denetimi | 🔴 KRİTİK | `api/stream-proxy/route.ts`, `api/image-proxy/route.ts` |
| **R-SEC-03** | Güvenlik | XSS & Güvensiz SVG / innerHTML Yasağı | 🔴 KRİTİK | `api/image-proxy/route.ts` (CSP Sandbox), React render |
| **R-SEC-04** | Güvenlik | Parametresiz Ham SQL Yasağı (SQLi) | 🔴 KRİTİK | `supabase` istemcileri, `database.py`, python scriptleri |
| **R-SEC-05** | Güvenlik | IDOR Engelleme & Sunucu Doğrulamalı Yetki | 🔴 KRİTİK | `api/**/route.ts`, Supabase RLS |
| **R-SEC-06** | Güvenlik | İstemci Rolüne Güvenmeme (`localStorage` rol yasağı) | 🔴 KRİTİK | `src/context/KoUpContext.tsx`, `lib/adminAuth.ts` |
| **R-SEC-07** | Güvenlik | Supabase RLS & Advisor (`ERROR`/`WARN`/`INFO`) Onarımı | 🔴 KRİTİK | `koup-app/supabase/migrations/*.sql` |
| **R-PERF-01**| Performans| N+1 Veritabanı ve API Şişirme Yasağı | 🟠 YÜKSEK | `src/lib/cache.ts`, toplu RPC ve join sorguları |
| **R-PERF-02**| Performans| Core Web Vitals (LCP < 2.5s, CLS < 0.1, INP < 200ms) | 🟠 YÜKSEK | Görsel lazy-loading, font yükleme, dynamic import |
| **R-PERF-03**| Performans| 4 Kademeli Mobil Performans Benchmarkı (1x/2x/4x/6x) | 🟠 YÜKSEK | `perf-benchmark-lab`, DevTools CPU Throttling |
| **R-PERF-04**| Performans| `useEffect` Event / Timer Cleanup Zorunluluğu | 🔴 KRİTİK | `NetflixPlayer.tsx`, timer/listener içeren hooklar |
| **R-DATA-01**| Veri / Arşiv| Tam Senkronizasyon Zinciri (SQLite ⇄ R2 ⇄ Supabase) | 🔴 KRİTİK | `scripts/upload_to_r2.py`, `scripts/export_sources_bundles.py` |
| **R-DATA-02**| Veri / Arşiv| Orijinal Afiş / MDL / AniList Bilgisini Ezmeme | 🟠 YÜKSEK | `api/image-proxy/route.ts`, `api/media/auto-enrich/route.ts` |
| **R-DEV-01** | Dev / Git | Durduk Yere `npm run dev` Başlatmama | 🟡 ORTA | Terminal süreç yönetimi |
| **R-DEV-02** | Dev / Git | Temiz Commit Disiplini (Geçici/Env Dosyası Commitlenmez)| 🔴 KRİTİK | `.gitignore`, `git status` |
| **R-DEV-03** | Dev / Git | Çalışma Alanı Temizliği (Çöp Script Bırakmama) | 🟡 ORTA | `scripts/`, `tmp/`, kök dizin |
| **R-DEV-04** | Disiplin | %100 Dürüstlük & Doğrulama (No Fake Success) | 🔴 KRİTİK | Test çıktıları, tip kontrolü, terminal doğrulama |
| **R-DOC-01** | Doküman | Yaşayan Dokümantasyon (`docs/`) Güncelleme Zorunluluğu | 🔴 KRİTİK | `docs/*.md`, `docs/CHANGELOG.md`, `GEMINI.md` |
| **R-DOC-02** | Orkestrasyon| Subagent Brifinginde Büyük Resim & Takım Görünürlüğü | 🟠 YÜKSEK | `invoke_subagent` çağrıları |

---

## 2. Tasarım, Arayüz ve Kullanıcı Deneyimi Standartları

### 2.1. Standart `<select>` Etiketi Kesin Yasağı
- **Kural:** Projenin hiçbir yerinde tarayıcının varsayılan HTML `<select>` veya `<option>` etiketleri kullanılamaz. Tüm açılır seçimler için mutlaka [`CustomSelect.tsx`](../koup-app/src/components/CustomSelect.tsx) bileşeni kullanılmalıdır.
- **Neden Var (Somut Risk):**
  - HTML `<select>` etiketinin açılır menüsü işletim sistemi tarafından render edilir (OS native). Bu durum karanlık mod (OLED) renk paletini bozar, iOS ve Android'de gri/beyaz çirkin kutular çıkarır.
  - Standart `<select>` içine arama kutusu (`searchable`), ikon (`leftIcon`), rozet, çoklu seçim (`multiple`) veya özel CSS animasyonu eklenemez.
  - Z-index ve `overflow: hidden` içeren modal/kart içlerinde kırpılma (clipping) sorunları yaratır.
- **Nasıl Uygulanır:**
  [`CustomSelect.tsx`](../koup-app/src/components/CustomSelect.tsx) bileşeni kullanılır. Portal desteği (`createPortal`), yay animasyonları (`motion/react`), klavye navigasyonu (ArrowDown/Up/Enter/Escape), viewport taşma kontrolü ve otomatik yön belirleme (`auto`, `up`, `down`) özelliklerine sahiptir.

```tsx
// ❌ YANLIŞ: Tarayıcı varsayılan select etiketi (KESİNLİKLE YASAK)
<select value={selectedQuality} onChange={(e) => setSelectedQuality(e.target.value)}>
  <option value="1080p">1080p Full HD</option>
  <option value="720p">720p HD</option>
</select>

// ✅ DOĞRU: KoUp CustomSelect bileşeni kullanımı
import CustomSelect from '@/components/CustomSelect';

<CustomSelect
  value={selectedQuality}
  onChange={(val) => setSelectedQuality(val)}
  options={[
    { value: '1080p', label: '1080p Full HD', description: 'En yüksek kalite' },
    { value: '720p', label: '720p HD', description: 'Dengeli veri kullanımı' }
  ]}
  variant="glass"
  size="sm"
  portal={true}
  aria-label="Yayın Kalitesi Seçimi"
/>
```

---

### 2.2. Aşırı Metin (Text-Heavy) ve Görsel Karmaşa Yasağı
- **Kural:** Arayüzde uzun paragraflar, açıklama metni yığınları, gereksiz bilgi etiketleri ve karmaşık görsel üst üste bindirmeler kesinlikle yasaktır.
- **Neden Var (Somut Risk):** KoUp bir film/dizi izleme ve arşivleme platformudur (Apple TV+, Netflix ve MUBI estetiği hedeflenir). Aşırı metin kullanıcının odağını dağıtır, arayüzü amatör bir blog veya veritabanı paneli havasına sokar ve mobil cihazlarda dikey kaydırma yorgunluğu yaratır.
- **Nasıl Uygulanır:**
  - Bilgiyi uzun metinle değil; temiz ikonografi (`lucide-react`), tipografik kontrast, dengeli boşluk (`padding`/`gap`), rozetler (`badge`) ve mikro-etkileşimlerle sunun.
  - Dizi açıklamalarını (sinopsis) mobilde maksimum 3 satırda (`line-clamp-3`) tutun, "Devamını Oku" ile genişletilebilir yapın.

```tsx
// ❌ YANLIŞ: Metin ağırlıklı, kalabalık ve göz yoran bilgi kutusu
<div className="p-4 bg-gray-900">
  <p className="text-sm">Bu dizi 2024 yılında Güney Kore'de tvN kanalında yayınlanmış olup toplam 16 bölümden oluşmaktadır ve türü romantik komedidir. Dizinin puanı 8.9 olup izleyiciler tarafından çok beğenilmiştir.</p>
</div>

// ✅ DOĞRU: Sade, ikonik ve net görsel hiyerarşi
<div className="flex items-center gap-3 text-xs text-white/70">
  <span className="px-2 py-0.5 rounded-full bg-white/10 font-semibold text-white">2024</span>
  <span className="flex items-center gap-1 text-amber-400 font-bold">
    <Star className="w-3.5 h-3.5 fill-current" /> 8.9
  </span>
  <span>tvN</span>
  <span>16 Bölüm</span>
  <span className="text-white/40">•</span>
  <span className="text-cyan-400">Romantik Komedi</span>
</div>
```

---

### 2.3. Sitenin Tasarım Dilinden Kopma Yasağı
- **Kural:** Yeni eklenen hiçbir sayfa, bileşen veya modül projenin sinematik Lumina OLED temasından, renk paletinden ve tipografisinden kopuk tasarlanamaz.
- **Neden Var (Somut Risk):** Başka bir projeden veya hazır UI kütüphanesinden kopyalanmış stiller (beyaz/açık gri arkaplanlar, parlak mavi standart bootstrap butonları, keskin köşeler) projenin bütünlüğünü yok eder.
- **Nasıl Uygulanır:**
  - Arkaplan: `#050508` / `#0a0a0f` OLED derin siyahı.
  - Kartlar: `bg-white/[0.03]` veya `bg-black/40` yarı şeffaf cam (glassmorphism), `backdrop-blur-md`, `border border-white/[0.08]`.
  - Vurgu renkleri: Sinematik cyan/amber/mor gradyanları veya Apple TV+ tarzı monokrom beyaz/opak düğmeler.
  - Butonlar: `rounded-full` veya `rounded-2xl`, yumuşak hover aydınlatması.

---

### 2.4. Akıcı Açılış/Kapanış Animasyonu Zorunluluğu
- **Kural:** Tüm açılır menüler, modallar, filtre çekmeceleri, bildirim balonları ve sekme geçişleri açılış ve kapanışta mutlaka GPU dostu animasyona sahip olmalıdır. Ani belirip kaybolan öğeler yasaktır.
- **Neden Var (Somut Risk):** Kapanış animasyonu olmayan veya doğrudan DOM'dan sökülen bileşenler arayüzde titreme (flicker) hissi yaratır ve modern streaming kalitesini zedeler.
- **Nasıl Uygulanır:**
  - Yalnızca GPU tarafından ivmelendirilen `transform` (scale, translate) ve `opacity` özellikleri kullanılır. Kesinlikle `height: auto` veya `width` gibi layout reflow tetikleyen CSS özellikleri animasyona sokulmaz.
  - React'te `motion/react` ve `AnimatePresence` kullanılır.

```tsx
// ✅ DOĞRU: AnimatePresence ile GPU dostu modal animasyonu
import { motion, AnimatePresence } from 'motion/react';

<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="backdrop-blur-xl bg-black/80 border border-white/10 rounded-2xl"
    >
      {content}
    </motion.div>
  )}
</AnimatePresence>
```

---

### 2.5. %100 Mobil Uyum ve 44x44px Dokunma Hedefi
- **Kural:** Eklenen her özellik mobilde test edilmelidir. Tüm tıklanabilir buton ve ikonların minimum dokunma hedefi (touch target) en az **44x44 piksel** olmalı ve sayfada hiçbir koşulda yatay taşma (`overflow-x`) oluşmamalıdır.
- **Neden Var (Somut Risk):** Mobil kullanıcılar parmakla dokunurken küçük butonları ıskalar, yanlış yerlere basar ve yatay kayan sayfalar kontrol kaybı hissi vererek kullanıcıyı siteden kaçırır.
- **Nasıl Uygulanır:**
  - İkon 18px olsa bile etrafındaki buton `min-w-[44px] min-h-[44px] flex items-center justify-center` olmalıdır.
  - Konteynerlerde `w-full max-w-full overflow-hidden` veya responsive grid/flex kullanılmalıdır.

---

### 2.6. %100 Dil Uyumu ve Site Dili Bütünlüğü (Language Consistency)
- **Kural:** Sitede hangi dil kullanılıyorsa (KoUp platformu için Türkçe), sisteme eklenecek tüm yeni özellikler, butonlar, menüler, etiketler (labels), form placeholder'ları, uyarı ve hata mesajları, bildirimler ve arayüz metinleri istisnasız olarak o dilde olacaktır.
- **Neden Var (Somut Risk):** Arayüzün bir kısmının İngilizce, bir kısmının Türkçe kalması (örn. "Watch Now", "Episodes", "Loading...", "Settings" gibi yabancı terimlerin Türkçe arayüz arasına karışması) profesyonel olmayan, yamalı ve kopuk bir kullanıcı deneyimi oluşturur.
- **Nasıl Uygulanır:**
  - Yeni bir bileşen veya metin yazılırken sitenin ana dili referans alınır.
  - Sabit İngilizce terimler yerine doğrudan Türkçe karşılıkları ("İzle", "Bölümler", "Yükleniyor...", "Ayarlar", "Ses & Altyazı") kullanılır.
  - İleride çoklu dil (i18n) desteği eklendiğinde tüm anahtarlar sözlükten okunacak şekilde izole edilir; arayüze doğrudan yabancı dilde sabit string gömülmez.

---

## 3. Güvenlik ve Kimlik Doğrulama Standartları

### 3.1. Kaynak Koda Gizli Anahtar Gömme Yasağı (Zero Hardcoded Secrets)
- **Kural:** `SUPABASE_SERVICE_ROLE_KEY`, Cloudflare R2 Secret Key, TMDB API Key, veritabanı şifresi veya herhangi bir yetkili token **kesinlikle kaynak kod dosyalarına doğrudan yazılamaz**.
- **Neden Var (Somut Risk):**
  - Kod dosyaları GitHub deposuna gönderildiğinde otomatik tarayıcılar (botlar) gizli anahtarları dakikalar içinde çalar.
  - `SUPABASE_SERVICE_ROLE_KEY` çalınırsa saldırgan Row Level Security (RLS) politikalarını bypass ederek tüm veritabanını silebilir veya dışarı aktarabilir.
  - `NEXT_PUBLIC_` ön eki taşıyan ortam değişkenleri Next.js tarafından istemciye (client bundle) gömülür. Gizli anahtara asla `NEXT_PUBLIC_` eklenemez!
- **Nasıl Uygulanır:**
  Tüm gizli anahtarlar yalnızca kökteki veya `koup-app/` altındaki `.env.local` dosyasında tutulur ve yalnızca sunucu tarafında (`route.ts`, sunucu aksiyonu veya server component) `process.env.ANAHTAR_ADI` ile okunur.

```typescript
// ❌ YANLIŞ: Gizli anahtarı kod içine gömmek (AĞIR GÜVENLİK İHLALİ)
const supabase = createClient(
  'https://xyz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.saldırgan_anahtarı_çalar...'
);

// ✅ DOĞRU: Sunucu tarafında ortam değişkeninden okuma
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Asla istemciye gönderilmez!
  { auth: { persistSession: false } }
);
```

---

### 3.2. SSRF (Server-Side Request Forgery) Koruma Kuralları
- **Kural:** Kullanıcıdan veya dış API'den gelen URL'lerin sunucu üzerinden vekil edildiği tüm uçlarda ([`/api/stream-proxy`](../koup-app/src/app/api/stream-proxy/route.ts#L30-L57) ve [`/api/image-proxy`](../koup-app/src/app/api/image-proxy/route.ts#L8-L50)) hedef adres mutlak DNS ve IP filtrelemesinden geçirilmelidir.
- **Neden Var (Somut Risk):**
  - Saldırgan `http://169.254.169.254/latest/meta-data/` çağırarak bulut sunucusunun AWS/GCP IAM kimlik bilgilerini çalabilir.
  - `http://localhost:3000` veya yerel ağdaki (192.168.x.x, 10.x.x.x) korumasız iç servislere sızabilir.
- **Nasıl Uygulanır:**
  - Özel IP aralıkları (127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, 169.254.0.0/16, IPv6 ::1 ve fe80::) reddedilir.
  - DNS lookup yapılarak hedef hostun bu IP'lere çözümlenip çözümlenmediği (`isBlockedAfterDnsLookup`) denetlenir.

---

### 3.3. XSS ve Güvenli HTML / SVG Render Standartları
- **Kural:** Kullanıcı girdileri, harici yorumlar ve dış sitelerden çekilen SVG veya HTML içerikleri filtrelenmeden doğrudan `dangerouslySetInnerHTML` ile ekrana basılamaz.
- **Neden Var (Somut Risk):** SVG dosyaları içinde `<script>` etiketleri veya `onload` fonksiyonları bulunabilir. Bu içerik doğrudan gösterilirse saldırgan kullanıcının oturum çerezlerini çalarak hesabını ele geçirebilir (Stored XSS).
- **Nasıl Uygulanır:**
  - [`/api/image-proxy`](../koup-app/src/app/api/image-proxy/route.ts#L1096-L1098) SVG yanıtı verirken `Content-Security-Policy: default-src 'none'; sandbox` başlığı ekler.
  - Harici görseller `sharp` kütüphanesiyle piksellere ayrıştırılıp güvenli WebP/JPEG formatına dönüştürülür.

---

### 3.4. SQL Injection Koruması ve Parametreli Sorgular
- **Kural:** Python scriptlerinde (`sqlite3`) ve Supabase sorgularında asla metin birleştirme (`f"SELECT * FROM ... WHERE id = '{user_input}'"`) ile dinamik SQL oluşturulamaz.
- **Neden Var (Somut Risk):** Tek bir `' OR 1=1 --` enjeksiyonu ile tüm arşiv veritabanı silinebilir veya bozulabilir.
- **Nasıl Uygulanır:**
  - Python'da `cursor.execute("SELECT ... WHERE id = ?", (media_id,))` parametreli tuple kullanılır.
  - Supabase'te SDK metodları (`.eq()`, `.ilike()`) veya RPC parametreleri kullanılır.

---

### 3.5. IDOR (Insecure Direct Object Reference) Engelleme
- **Kural:** Bir kullanıcının izleme geçmişini, listesini, profil bilgilerini veya bildirimlerini güncelleyen hiçbir API ucu, hedef `user_id` değerini istemcinin gönderdiği parametreden (`body.userId`) doğrudan kabul edemez.
- **Neden Var (Somut Risk):** Kötü niyetli bir kullanıcı başka birinin UUID'sini istek gövdesine yazarak başkasının izleme geçmişini silebilir, listelerini değiştirebilir veya kişisel bilgilerini görebilir.
- **Nasıl Uygulanır:**
  Oturum açan kullanıcının kimliği yalnızca doğrulanmış JWT token üzerinden (`supabase.auth.getUser(token)`) sunucuda çözülür. İstekteki ID ile JWT'deki ID uyuşmak zorundadır.

---

### 3.6. API Yetkilendirme, Katı Şema Doğrulama ve Rate-Limiting
- **Kural:**
  - Admin/Moderatör uçları ([`/api/admin/**`](../koup-app/src/lib/adminAuth.ts#L118-L180)) mutlaka `verifyAdminAuth(req)` ile denetlenmelidir.
  - İstemciden gelen rol bilgisine (`localStorage.role` veya çerezdeki role) asla güvenilemez; rol **sadece ve sadece veritabanındaki `profiles` tablosundan** okunur ([`KoUpContext.tsx#L737`](../koup-app/src/context/KoUpContext.tsx#L737)).
  - Tüm API uçlarında istek sıklığı sınırlandırılmalı (`checkAdminRateLimit` / `rateBucket`) ve girdi verileri şema doğrulamasından geçirilmelidir.

---

### 3.7. Supabase RLS ve Advisor (ERROR / WARN / INFO) Onarım Zorunluluğu
- **Kural:** Supabase üzerindeki tüm public tablolarında Row Level Security (RLS) etkinleştirilmelidir (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). Supabase MCP `get_advisors` denetiminde çıkan **ERROR, WARN ve INFO** seviyesindeki tüm bulgular düzeltilmelidir.
- **Neden Var (Somut Risk):** RLS açık olmayan bir tabloya anonim istemci anahtarıyla doğrudan HTTP REST çağrısı yapılarak tüm veri okunabilir veya değiştirilebilir. Fonksiyonlarda `SET search_path = ''` tanımlanmazsa kötü niyetli şema enjeksiyonları mümkündür.

---

## 4. Performans, Veritabanı ve Bellek Standartları

### 4.1. N+1 Veritabanı ve API Şişirme Yasağı
- **Kural:** Bir döngü içinde sırayla tek tek veritabanı sorgusu veya HTTP isteği atmak (N+1 problemi) kesinlikle yasaktır.
- **Neden Var (Somut Risk):** 100 elemanlı bir liste için 100 ayrı sorgu atmak Supabase havuzunu (connection pool) kilitler, gecikmeyi saniyelerin üzerine çıkarır ve Vercel/Supabase kotalarını hızla tüketir.
- **Nasıl Uygulanır:**
  Veriler tek bir `.in('id', idList)` sorgusuyla veya SQL JOIN / Supabase Foreign Key ilişkisiyle topluca çekilip bellek içi `Map<id, Item>` yapısıyla eşleştirilir.

---

### 4.2. Core Web Vitals (CWV) Standartları
KoUp web uygulaması aşağıdaki Core Web Vitals hedeflerini sağlamak zorundadır:
- **LCP (Largest Contentful Paint):** < 2.5 saniye. (Afiş görselleri optimize edilir, hero alanı sunucu tarafında hazır gelir).
- **CLS (Cumulative Layout Shift):** < 0.1. (Görsellere sabit en-boy oranı `aspect-[2/3]` verilir, içerik yüklenirken iskelet/skeleton bileşenler sabit boyutta kalır).
- **INP (Interaction to Next Paint):** < 200 ms. (Tıklama ve sürükleme etkileşimlerinde ağır işlemler `requestAnimationFrame` veya microtask içine alınır).

---

### 4.3. 4 Kademeli Mobil Performans Benchmark Kuralı
- **Kural:** Bir özellik geliştirildiğinde veya optimize edildiğinde yalnızca masaüstü bilgisayarın güçlü işlemcisiyle test yapılamaz. Performans testleri 4 kademede doğrulanır:
  1. **PC / Masaüstü:** 1x CPU (Referans Hız)
  2. **Yüksek Segment Mobil:** 2x CPU Yavaşlatma
  3. **Orta Segment Mobil:** 4x CPU Yavaşlatma (Standart Android Cihazlar)
  4. **Düşük Segment Mobil:** 6x CPU Yavaşlatma (Giriş Seviyesi Telefonlar)
- **Neden Var:** Asya dizisi ve anime izleyicilerinin %70'inden fazlası siteyi mobil cihazlardan ziyaret eder. Düşük işlemcili cihazlarda donan veya pili aşırı tüketen bir arayüz doğrudan kullanıcı kaybıdır.

---

### 4.4. `useEffect` Bellek Sızıntısı ve Cleanup Zorunluluğu
- **Kural:** React bileşenlerinde tanımlanan tüm `setInterval`, `setTimeout`, `addEventListener`, `ResizeObserver`, Hls.js oynatıcı instance'ları ve WebSocket/Realtime abonelikleri, `useEffect` cleanup fonksiyonunda **mutlaka temizlenmelidir**.
- **Neden Var (Somut Risk):** Kullanıcı sayfalar arasında dolaştıkça arka planda çalışan eski interval veya video akışları bellek sızıntısına (memory leak) yol açar, tarayıcı sekmesini yavaşlatır ve nihayetinde çökertebilir (`Out of Memory`).

```tsx
// ✅ DOĞRU: Eksiksiz cleanup içeren useEffect
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}, [closeModal]);
```

---

## 5. Arşiv Yönetimi ve Depolama Eşitleme Zinciri

### 5.1. Tam Arşiv Senkronizasyon Zinciri Zorunluluğu
- **Kural:** Yerel arşiv veritabanında (`webdrama_archive.db`) yapılan herhangi bir veri düzeltme, temizleme (purge), kaynak onarımı (heal), tekilleştirme (merge) veya yeni bölüm ekleme işlemi sonrasında yalnızca yerel veritabanında kalmak **kesinlikle yasaktır**. Senkronizasyon zincirinin 3 halkası da tamamlanmalıdır:
  1. **Halka 1 - SQLite WAL Checkpoint & R2 DB Yedeği:** SQLite veritabanı WAL checkpoint yapıldıktan sonra Cloudflare R2 üzerindeki `db/webdrama_archive.db` konumuna yüklenir.
  2. **Halka 2 - R2 Arşiv Paketleri (Bundles Sync):** Güncellenen yapımların tekil JSON paketleri (`r2_bundles/sources/{id}.json`) dışa aktarılır ([`export_sources_bundles.py`](../scripts/export_sources_bundles.py)) ve R2'ye yüklenir ([`upload_to_r2.py`](../scripts/upload_to_r2.py)).
  3. **Halka 3 - Supabase Senkronizasyonu:** Güncellenen bölümler ve yapımlar Supabase `media` ve `episodes` tablolarına aktarılır ([`sync_all_episodes_to_supabase.py`](../scripts/sync_all_episodes_to_supabase.py)).
- **Neden Var (Somut Risk):** Bir halka eksik bırakılırsa, kullanıcı sitede izlemeye çalıştığında R2 paketinde eski ölü linkleri görür veya Supabase üzerinde bölüm listesi güncellenmediği için yeni bölümler sitede hiç görünmez.

---

### 5.2. Orijinal Afiş ve Metadata Koruma Kuralı
- **Kural:** Kazıyıcılardan (scrapers), AniList'ten, MyDramaList'ten veya kısa drama kaynaklarından (DramaVadisi, Shortİzle) gelen orijinal afiş ve başlık verileri, TMDB otomatik zenginleştirmesi sırasında asla ezilemez ([`/api/image-proxy`](../koup-app/src/app/api/image-proxy/route.ts#L74-L83) ve [`/api/media/auto-enrich`](../koup-app/src/app/api/media/auto-enrich/route.ts#L519-L584)).
- **Neden Var (Somut Risk):** TMDB arama motoru kısa dramaları ("Part 2", "Season 3" gibi genel başlıkları) bilmez ve alakasız Hollywood filmleriyle eşleştirerek afişi ve açıklamayı tamamen bozar.

---

## 6. Geliştirme Ortamı, Terminal ve Git Disiplini

### 6.1. Durduk Yere Dev Server Başlatmama Disiplini
- **Kural:** Kullanıcı açıkça talep etmedikçe veya canlı tarayıcı testi zorunlu olmadıkça ajanlar kendi kendilerine terminalde `npm run dev` başlatamaz.
- **Neden Var (Somut Risk):** Arka planda unutulan dev sunucuları portları işgal eder (`localhost:3000` çakışması), CPU/RAM tüketir ve `.next` önbelleğini kilitleyerek `npx tsc --noEmit` veya derleme işlemlerinin çökmesine yol açar.

---

### 6.2. Temiz Git Commit ve Push Disiplini
- **Kural:**
  - Bir geliştirme, refaktör veya onarım tamamlanıp doğrulandıktan sonra değişiklikler anlamlı bir commit mesajıyla kaydedilmeli ve repoya gönderilmelidir.
  - `.env`, `.env.local`, API anahtarları, geçici log dosyaları, test çıktıları veya SQLite WAL geçici dosyaları **asla commitlenemez**.
- **Nasıl Uygulanır:**
  Her commit öncesi `git status` ile çalışma alanı gözden geçirilir.

---

### 6.3. Çalışma Alanı Temizliği ve Çöp Dosya Bırakmama
- **Kural:** Görev sırasında oluşturulan geçici test scriptleri (örneğin `test_resolve.py`, `temp_dump.json`), tek kullanımlık analiz scriptleri veya log dosyaları iş tamamlandığında **mutlaka silinmelidir**. Proje kökünde çöp dosya bırakılamaz.

---

### 6.4. %100 Dürüstlük ve Doğrulama (No Fake Success)
- **Kural:** Bir özellik, düzeltme veya API ucu gerçekten test edilip çalıştığı doğrulanmadan asla "çalışıyor", "düzeltildi" veya "tamamlandı" denilemez.
- **Neden Var (Somut Risk):** Varsayıma dayalı sahte başarı beyanları kullanıcı güvenini sıfırlar ve zincirleme gizli hatalara sebep olur.
- **Nasıl Uygulanır:**
  - TypeScript tip kontrolü (`npx tsc --noEmit`) hatasız geçmelidir.
  - İlgili uçlar terminal komutlarıyla (curl, python istekleri) bizzat tetiklenip 200 OK yanıtı doğrulanmalıdır.

---

## 7. Yaşayan Dokümantasyon ve Subagent Protokolleri

### 7.1. Yaşayan Dokümantasyon Zorunluluğu (GEMINI.md §12)
- **Kural:** Sitenin tek doğruluk kaynağı `docs/` klasörüdür. Yeni bir sayfa, bileşen, API ucu, script, tablo veya kural eklendiğinde, aynı görev içinde ilgili doküman dosyası güncellenecek ve [`docs/CHANGELOG.md`](./CHANGELOG.md) dosyasına işlenecektir. Doküman güncellenmeden görev "tamamlandı" sayılamaz.

---

### 7.2. Alt Ajan Brifinginde Büyük Resim ve Takım Görünürlüğü
- **Kural:** Ana Ajan (Master Orchestrator), alt ajanlara (`invoke_subagent`) asla sadece dar ve mekanik görevler veremez. Her alt ajanın brifingine:
  1. Kullanıcının ana talebi ve varmak istediğimiz **Büyük Resim**,
  2. O anda sahada görev yapan diğer paralel ajanların tam listesi, rolleri ve **kilitledikleri dosyalar (Exclusive Lock)** eksiksiz yazılmalıdır.
- **Neden Var:** Alt ajanlar izole kaldıklarında birbirlerinin dosyalarını ezebilir veya genel mimariyle çelişen varsayımlarla hata yapabilirler.

---

## 8. İlgili Dokümanlar
- [01-genel-bakis-ve-mimari.md](./01-genel-bakis-ve-mimari.md) — 3 Katmanlı Mimari ve Veri Akışı
- [04-bilesenler-ve-tasarim-sistemi.md](./04-bilesenler-ve-tasarim-sistemi.md) — CustomSelect ve Tasarım Dili
- [07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md) — AdminAuth, RLS ve Güvenlik
- [09-kaziyicilar-scriptler-ve-senkron.md](./09-kaziyicilar-scriptler-ve-senkron.md) — Tam Senkronizasyon Zinciri
- [13-sss.md](./13-sss.md) — Sıkça Sorulan Sorular ve Hızlı Çözümler
- [14-dokumantasyon-rehberi.md](./14-dokumantasyon-rehberi.md) — Dokümantasyon Güncelleme Rehberi
- [CHANGELOG.md](./CHANGELOG.md) — Sürüm ve Değişiklik Günlüğü
