# KoUp Bileşenler ve Tasarım Sistemi Rehberi

Bu doküman, KoUp platformunun görsel kimliğini, Apple TV+ ve Netflix kalitesindeki karanlık mod sinematik tasarım sistemini, CSS değişkenlerini, animasyon prensiplerini, mobil uyum standartlarını ve `src/components/` altındaki tüm bileşenlerin API referansını eksiksiz biçimde açıklar.

---

## İçindekiler

1. [Tasarım Dili ve Görsel Felsefe](#1-tasarim-dili-ve-gorsel-felsefe)
   - [Sinematik Karanlık Tema & Renk Paleti](#sinematik-karanlik-tema--renk-paleti)
   - [Cam Efektleri & Yüzey Primitifleri (Glassmorphism)](#cam-efektleri--yuzey-primitifleri-glassmorphism)
   - [Radyal Parlamalar (Cinema Dispersed Radial Glows)](#radyal-parlamalar-cinema-dispersed-radial-glows)
   - [Tipografi ve Webfont Entegrasyonu](#tipografi-ve-webfont-entegrasyonu)
2. [Animasyon Prensipleri ve Mikro Etkileşimler](#2-animasyon-prensipleri-ve-mikro-etkilesimler)
   - [Açılış/Kapanış Animasyonu Zorunluluğu ve Gerekçesi](#aciliskapanis-animasyonu-zorunlulugu-ve-gerekcesi)
   - [Spring ve Easing Zamanlama Eğrileri](#spring-ve-easing-zamanlama-egrileri)
   - [Erişilebilirlik: `prefers-reduced-motion`](#erisilebilirlik-prefers-reduced-motion)
3. [%100 Mobil Uyum ve Dokunmatik Standartlar](#3-100-mobil-uyum-ve-dokunmatik-standartlar)
   - [Dokunma Hedefi (44x44px Touch Target)](#dokunma-hedefi-44x44px-touch-target)
   - [Yatay Taşma Yasağı ve Donanım Hızlandırmalı Raylar](#yatay-tasma-yasagi-ve-donanim-hizlandirmali-raylar)
   - [Dokunmatik Cihaz Optimizasyonları (Sticky Hover Önleme)](#dokunmatik-cihaz-optimizasyonlari-sticky-hover-onleme)
   - [Breakpoint Standartları](#breakpoint-standartlari)
4. [ÖZEL BÖLÜM: CustomSelect ve Standart Dropdown Mimarisi](#4-ozel-bolum-customselect-ve-standart-dropdown-mimarisi)
   - [Tarayıcının Varsayılan `<select>` Etiketi Neden KESİNLİKLE YASAKTIR?](#tarayicinin-varsayilan-select-etiketi-neden-kesinlikle-yasaktir)
   - [CustomSelect API Referansı ve TypeScript Tipleri](#customselect-api-referansi-ve-typescript-tipleri)
   - [Tekli ve Çoklu Seçim Örnekleri](#tekli-ve-coklu-secim-ornekleri)
   - [Portal, Dinamik Konumlandırma ve Klavye Erişilebilirliği](#portal-dinamik-konumlandirma-ve-klavye-erisilebilirligi)
5. [Ortak UI Primitifleri ("Yeni Bileşen Yazma, Bunları Kullan")](#5-ortak-ui-primitifleri-yeni-bilesen-yazma-bunlari-kullan)
   - [Girdi Alanları: `KoupInput` & `KoupTextarea`](#girdi-alanlari-koupinput--kouptextarea)
   - [Onay Modalı: `ConfirmModal`](#onay-modali-confirmmodal)
   - [Kimlik Doğrulama: `AuthModal`](#kimlik-dogrulama-authmodal)
   - [Sayfalama: `Pagination`](#sayfalama-pagination)
   - [Modal, Popover ve Backdrop Mimarisi](#modal-popover-ve-backdrop-mimarisi)
6. [Tüm Bileşenlerin Kapsamlı Kataloğu (31 Bileşen)](#6-tum-bilesenlerin-kapsamli-katalogu)
   - [AccordionMediaCard](#accordionmediacard)
   - [DirectMediaCard](#directmediacard)
   - [Navbar](#navbar)
   - [Footer](#footer)
   - [EpisodeRail](#episoderail)
   - [FranchiseWatchOrder](#franchisewatchorder)
   - [Top10Numeral](#top10numeral)
   - [WikiBioText](#wikibiotext)
   - [CountryFlag](#countryflag)
   - [CookieConsentBanner](#cookieconsentbanner)
   - [AddToListModal](#addtolistmodal)
   - [PageTransition & ScrollRestoration](#pagetransition--scrollrestoration)
   - [ShortsRail & ShortsCard](#shortsrail--shortscard)
   - [Oynatıcı Bileşenleri Özeti (05'e Referans)](#oynatici-bilesenleri-ozeti)
   - [Topluluk & Yorum Bileşenleri Özeti (10'a Referans)](#topluluk--yorum-bilesenleri-ozeti)
   - [Admin Yönetim Bileşenleri Tablosu (07'ye Referans)](#admin-yonetim-bilesenleri-tablosu)
7. [Önemli UI Hook'ları Özeti](#7-onemli-ui-hooklari-ozeti)
8. [Yeni UI Bileşeni Eklerken Kontrol Listesi](#8-yeni-ui-bileseni-eklerken-kontrol-listesi)
9. [İlgili Dokümanlar](#9-ilgili-dokumanlar)

---

## 1. Tasarım Dili ve Görsel Felsefe

KoUp'un görsel felsefesi **Apple TV+ zarafeti ile Netflix akıcılığını** birleştirir. Arayüzde aşırı metin (text-heavy) yığınları, kalabalık etiketler veya karmaşık kutucuklar kesinlikle yasaktır; görsel hiyerarşi **büyük temiz afişler, dengeli negatif alan (whitespace), mikro cam parlamaları ve net tipografik kontrast** üzerine kuruludur.

### Sinematik Karanlık Tema & Renk Paleti
Tüm renkler [`koup-app/src/app/globals.css`](../koup-app/src/app/globals.css) dosyasında CSS Custom Properties olarak tanımlanmıştır:

| CSS Değişkeni | Renk Kodu | Kullanım Amacı |
|---|---|---|
| `--bg-canvas` | `#080808` | Kök arka plan (saf derin siyah, OLED dostu) |
| `--bg-surface` | `#0f0f11` | Kart, modül ve ray taban yüzeyi |
| `--bg-elevated` | `#17171a` | Popover, dropdown ve hover yükseltilmiş katman |
| `--glass-bg` | `rgba(14, 14, 16, 0.82)` | Yarı saydam cam katman arka planı |
| `--glass-border` | `rgba(255, 255, 255, 0.1)` | Yumuşak cam kenarlık sınırı |
| `--glass-highlight` | `rgba(255, 255, 255, 0.18)` | Üst ışık vuruşu (inner highlight) |
| `--accent-blue` | `#2997ff` | KoUp birincil aksiyon mavisi (Apple Cinema Blue) |
| `--accent-cyan` | `#38bdf8` | Vurgu ve odaklama halkası (Lumina Focus Ring) |
| `--accent-amber` | `#e5a93c` | Uyarı, bölüm rozeti ve Shorts vurgusu |
| `--imdb-gold` | `#f5c518` | IMDb ve MDL puan yıldızları |
| `--accent-emerald` | `#10b981` | Başarılı işlem, tamamlanan bölüm rozeti |
| `--accent-crimson` | `#f43f5e` | Favori kalp butonu, tehlikeli silme işlemleri |
| `--accent-violet` | `#a855f7` | Anime ve Seiyuu özel kategori rozetleri |

### Cam Efektleri & Yüzey Primitifleri (Glassmorphism)
Sitede kullanılan tüm cam efektleri donanım hızlandırmalı ve arka planı matlaştıran `backdrop-filter: blur(...)` sınıflarıyla standardize edilmiştir:
- `.apple-glass`: Kart yüzeyleri için `#0f0f11` tabanı, `border: 1px solid rgba(255, 255, 255, 0.08)` ve `box-shadow: 0 20px 45px rgba(0, 0, 0, 0.75)`.
- `.glass-pill`: Butonlar ve filtre hapları için `rgba(255, 255, 255, 0.09)` arka plan, `border: 1px solid rgba(255, 255, 255, 0.13)`. Hover anında parlaklık artar (`rgba(255, 255, 255, 0.18)`).
- `.liquid-glass-bar`: Navbar ve sabit menüler için `rgba(14, 14, 16, 0.88)` arka plan, `backdrop-filter: blur(12px)` ve `box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6)`.
- `.liquid-glass-active-pill`: Menüde aktif sayfa sekmesini gösteren `rgba(255, 255, 255, 0.12)` cam kapsülü.

### Radyal Parlamalar (Cinema Dispersed Radial Glows)
Kutulu (boxy) ve sert kenarlı gölgeler yerine 3 katmanlı Gaussian yayılımlı radyal ışık haresi (`glow-blue`, `glow-white`, `glow-amber`, `glow-rose`) kullanılır:
- **Katman 1 (Yakın Hüzme):** `0 0 10px rgba(41, 151, 255, 0.32)`
- **Katman 2 (Orta Alan):** `0 0 22px -2px rgba(41, 151, 255, 0.22)` (Negatif spread köşe yığılmasını engeller)
- **Katman 3 (Derin Atmosfer):** `0 0 42px -4px rgba(41, 151, 255, 0.12)` (Karanlık zeminle pürüzsüz erime)

### Tipografi ve Webfont Entegrasyonu
1. **`Plus Jakarta Sans` (`--font-sans`):** Arayüzün ana metin fontudur. Yüksek x-height ve açık sayaç oranlarıyla küçük puntolarda bile olağanüstü okunabilirlik sağlar.
2. **`JetBrains Mono` (`--font-mono`):** Süre sayaçları, bölüm sayıları, saat bilgileri ve kod parçalarında karakter genişliklerinin sabit kalması (tabuler rakam) için kullanılır.
3. **`Netflix Sans`:** Sinematik başlıklar ve afiş üstü tipografi için `/fonts/NetflixSans_W_*.woff2` konumundan yerel olarak sunulur.

---

## 2. Animasyon Prensipleri ve Mikro Etkileşimler

### Açılış/Kapanış Animasyonu Zorunluluğu ve Gerekçesi
KoUp tasarım standardında **hiçbir açılır menü, modal, popover, bildirim veya kart ekranda "çat" diye aniden belirip kaybolamaz**.
- **Neden Zorunlu?** Anlık açılıp kapanmalar kullanıcıda sistemin takıldığı veya donduğu hissini uyandırır. Akıcı açılış/kapanış animasyonları insan beynine etkileşimin nereden başladığını ve nereye kapandığını gösterir (spatial continuity).
- **GPU Dostu Kuralı:** Animasyonlar asla CPU'yu yoran ve layout reflow'a sebep olan `width`, `height`, `top`, `margin` gibi özelliklerle yapılmaz! Yalnızca GPU'nun compositing katmanında çalışan `transform: scale()`, `translate3d()` ve `opacity` özellikleri kullanılır. Böylece 120Hz/144Hz mobil ekranlarda bile sıfır takılma (jank-free) elde edilir.

### Spring ve Easing Zamanlama Eğrileri
CSS ve `motion/react` kütüphanesinde tanımlı standart eğriler:
- `--spring-apple: cubic-bezier(0.16, 1, 0.3, 1)` — Buton basışları ve modal girişleri için elastik ama kontrollü Apple spring eğrisi.
- `--ease-cinema: cubic-bezier(0.22, 1, 0.36, 1)` — Sayfa ve ray geçişleri için sinematik akış eğrisi.
- Zamanlama Değerleri:
  - Hızlı Mikro-etkileşim (`--dur-fast`): `160ms` (Buton hover, renk değişimi)
  - Normal Açılış/Kapanış (`--dur-normal`): `260ms` (Dropdown menü, tooltip)
  - Geniş Katman Geçişi (`--dur-smooth`): `420ms` (Modal, tam ekran çekmece)

### Erişilebilirlik: `prefers-reduced-motion`
Kullanıcı işletim sisteminde hareket azaltma tercih etmişse sistem otomatik olarak CSS `--animation-reduced: 1` değişkenine geçer; `PageTransition` ve `template.tsx` içindeki kayma efektleri devre dışı kalarak saf solma (fade) moduna geçilir.

---

## 3. %100 Mobil Uyum ve Dokunmatik Standartlar

### Dokunma Hedefi (44x44px Touch Target)
W3C ve Apple İnsan Arayüzü İlkeleri (HIG) gereğince mobilde etkileşime girilen her buton, ikon ve menü elemanı **en az 44x44 piksel** etkin dokunma alanına sahiptir. Küçük ikonlar (`16x16px` veya `20x20px`) kullanıldığında bile etraflarına görünmez padding (`p-2.5` veya `p-3`) verilerek parmakla ıskalama engellenir.

### Yatay Taşma Yasağı ve Donanım Hızlandırmalı Raylar
- **Yatay Taşma Kesinlikle Yasaktır:** `html` ve `body` üzerinde `overflow-x: clip` uygulanır. Sayfanın sağa-sola istemsiz kayması veya boşluk vermesi en ağır UI hatası kabul edilir.
- **Raylar:** Afiş ve bölüm raylarında (`.overflow-x-auto`) `-webkit-overflow-scrolling: touch` kullanılarak yerel donanım hızlandırmalı pürüzsüz kaydırma sağlanır.

### Dokunmatik Cihaz Optimizasyonları (Sticky Hover Önleme)
Dokunmatik ekranlarda fare olmadığından butonlara tıklandıktan sonra hover stilinin takılı kalması (sticky hover) kullanıcı deneyimini bozar. `globals.css` içinde `@media (hover: none) and (pointer: coarse)` medya sorgusu ile dokunmatik ekranlarda:
- `-webkit-tap-highlight-color: transparent !important;`
- `touch-action: manipulation;`
- Dokunma sonrası odak halkası ve sticky hover efektleri temizlenir.

### Breakpoint Standartları
Tailwind CSS v4 standart breakpoint'leri uygulanır:
- `sm`: `640px` (Büyük telefonlar / yatay mod)
- `md`: `768px` (Tabletler ve dikey katlanabilirler — Masaüstü navigasyon geçiş sınırı)
- `lg`: `1024px` (Laptop / küçük masaüstü)
- `xl`: `1280px` (Standart sinema ekranı)
- `2xl`: `1536px` (Ultra geniş monitörler)


---

## 4. ÖZEL BÖLÜM: CustomSelect ve Standart Dropdown Mimarisi

- **Dosya:** [`koup-app/src/components/CustomSelect.tsx`](../koup-app/src/components/CustomSelect.tsx)

### Tarayıcının Varsayılan `<select>` Etiketi Neden KESİNLİKLE YASAKTIR?
KoUp kod tabanında HTML varsayılan `<select>` etiketinin kullanılması kesin bir kural ihlalidir (`GEMINI.md` ve proje standartları). Bunun teknik ve görsel gerekçeleri şunlardır:
1. **İşletim Sistemine Bağımlı Kaba Görünüm:** Varsayılan `<select>` etiketinin açılır penceresi tarayıcı ve işletim sistemi (Windows gri kutusu, macOS beyaz popup'ı, Android tekerleği) tarafından çizilir. Sitenin sinematik, karanlık, yarı saydam ve pürüzsüz estetiğini tamamen parçalar.
2. **CSS ile Özelleştirilemez:** Açılır `<option>` etiketlerinin içine CSS ile ikon, bayrak, alt açıklama metni, hover rengi, köşe yuvarlatma (border-radius) veya cam efekti (backdrop-filter) verilemez.
3. **Animasyon Desteği Yoktur:** Varsayılan menü pat diye aniden açılır ve kapanır. GPU hızlandırmalı spring animasyonu, yumuşak ölçeklenme (scale) veya solma (fade) uygulanamaz.
4. **Arama ve Filtreleme Eklenemez:** 50'den fazla seçenek olduğunda (örneğin onlarca kategori, yüzlerce yıl veya fansub listesi) kullanıcının arama yapabileceği bir metin kutusu konamaz.
5. **Mobil Klavye Patlamaları:** Dokunmatik cihazlarda standart select menüsü açıldığında sanal klavye veya devasa bir tekerlek açılarak tüm sayfayı kaydırır ve layout shift yaratır.
6. **Çoklu Seçim (Multi-Select) Rezilliği:** Varsayılan select çoklu seçimde masaüstünde kullanıcıyı `Ctrl` veya `Cmd` tuşuna basılı tutmaya zorlar; mobilde ise kullanılamaz durumdadır.

### CustomSelect API Referansı ve TypeScript Tipleri

```typescript
export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface BaseCustomSelectProps {
  options: SelectOption[];
  placeholder?: string;
  triggerLabel?: React.ReactNode;
  leftIcon?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  variant?: 'pill' | 'glass' | 'white' | 'dark'; // Varsayılan: 'glass'
  size?: 'sm' | 'md';                            // Varsayılan: 'md'
  direction?: 'up' | 'down' | 'auto';            // Varsayılan: 'auto'
  searchable?: boolean;                          // 8+ seçenekte otomatik aktif
  searchPlaceholder?: string;                    // Varsayılan: 'Seçenek ara...'
  portal?: boolean;                              // Varsayılan: true (document.body)
  disabled?: boolean;
  allowDeselect?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

// Tekli Seçim Modu
export interface SingleCustomSelectProps extends BaseCustomSelectProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

// Çoklu Seçim Modu
export interface MultiCustomSelectProps extends BaseCustomSelectProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}
```

### Tekli ve Çoklu Seçim Örnekleri

#### Örnek 1: Tekli Seçim (Single Select — Sıralama Dropdown'ı)
```tsx
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import { ArrowUpDown, Star, Clock } from 'lucide-react';

const SORT_OPTIONS: SelectOption[] = [
  { value: 'popular', label: 'Popülerlik', icon: <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" /> },
  { value: 'rating', label: 'KoUp Puanı', icon: <Star className="w-3.5 h-3.5 text-amber-400" /> },
  { value: 'newest', label: 'En Yeni', icon: <Clock className="w-3.5 h-3.5 text-emerald-400" /> },
];

export function SeriesSortFilter() {
  const [sort, setSort] = useState('popular');

  return (
    <CustomSelect
      value={sort}
      onChange={setSort}
      options={SORT_OPTIONS}
      variant="glass"
      size="sm"
    />
  );
}
```

#### Örnek 2: Çoklu Seçim (Multi Select — Ülke veya Tür Filtresi)
```tsx
const COUNTRY_OPTIONS: SelectOption[] = [
  { value: 'ALL', label: 'Tüm Ülkeler' },
  { value: 'KR', label: 'Güney Kore' },
  { value: 'JP', label: 'Japonya' },
  { value: 'CN', label: 'Çin' },
];

export function CountryMultiFilter() {
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  return (
    <CustomSelect
      multiple={true}
      value={selectedCountries}
      onChange={setSelectedCountries}
      options={COUNTRY_OPTIONS}
      placeholder="Ülke Filtrele"
      searchable={true}
      searchPlaceholder="Ülke ara..."
    />
  );
}
```

### Portal, Dinamik Konumlandırma ve Klavye Erişilebilirliği
- **React Portal Mimarisi:** Menü varsayılan olarak `createPortal(menuContent, document.body)` ile doğrudan `<body>` etiketinin sonuna basılır. Bu sayede menü ebeveyn div'lerdeki `overflow: hidden`, `z-index` çakışmaları veya modal içi kesilmelerden (clipping) %100 izole edilir.
- **Akıllı Yön Tayini (`calculatePosition`):** Tetikleyici butonun ekrandaki koordinatları `getBoundingClientRect()` ile anlık hesaplanır. Butonun altında 280px'den az yer varsa ve üstte yeterli alan varsa menü otomatik olarak yukarıya doğru (`direction: 'up'`) açılır. Sayfa kaydırıldığında veya pencere boyutu değiştiğinde `requestAnimationFrame` ile menü konumu senkronize edilir.
- **WAI-ARIA & Klavye Desteği:**
  - Buton: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`.
  - Liste: `role="listbox"`, elemanlar `role="option"` (çokluda `role="checkbox"`).
  - Tuşlar: `ArrowDown` ve `ArrowUp` seçenekler arasında gezinir; `Home` ilk seçeneğe, `End` son seçeneğe zıplar; `Enter` seçimi yapar; `Escape` menüyü kapatıp odağı tetikleyici butona iade eder.

---

## 5. Ortak UI Primitifleri ("Yeni Bileşen Yazma, Bunları Kullan")

KoUp tasarım tutarlılığını korumak için buton, girdi, modal ve sayfalama gibi temel bileşenlerin sıfırdan yeniden yazılması yasaklanmıştır. Projedeki hazır primitifler şunlardır:

### Girdi Alanları: `KoupInput` & `KoupTextarea`
- **Dosya:** [`koup-app/src/components/KoupInput.tsx`](../koup-app/src/components/KoupInput.tsx)
- **Tasarım:** `#0e0e12/80` tabanı, `backdrop-blur-2xl`, `border-white/12`, yuvarlatılmış hap form (`rounded-2xl`).
- **Özellikler:**
  - Sol ikon yuvası (`leftIcon`) ve sağ aksiyon/durum yuvası (`rightSlot`, `rightAction`).
  - Dahili tek tıkla temizleme butonu (`clearable`, `onClear`).
  - Parlama rengi seçenekleri (`glowColor: 'blue' | 'amber' | 'emerald'`).
  - Hata mesajı (`error`) ve bilgilendirme metni (`hint`) desteği.
  - `KoupTextarea` çok satırlı metinler için otomatik `rounded-1.25rem` geçişi sunar.

```tsx
// Kullanım Örneği
<KoupInput
  label="E-posta Adresi"
  placeholder="ornek@koup.tv"
  leftIcon={<Mail className="w-4 h-4" />}
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={emailError}
  clearable
  onClear={() => setEmail('')}
/>
```

### Onay Modalı: `ConfirmModal`
- **Dosya:** [`koup-app/src/components/ConfirmModal.tsx`](../koup-app/src/components/ConfirmModal.tsx)
- **Ne İşe Yarar:** Kullanıcı geçmişi silerken, kütüphaneden yapım kaldırırken, oturumu kapatırken veya hesabı silerken açılan standart onay penceresidir. Tarayıcının çirkin `window.confirm()` uyarısının yerini alır.
- **Tasarım & Güvenlik:**
  - `role="alertdialog"`, `aria-modal="true"`.
  - `isDestructive` modu açıkken tehlikeyi vurgulamak için kırmızı/rose parıltılı çöp kutusu ikonu (`Trash2`), kırmızı gölge (`glow-rose`) ve kırmızı onay butonu kullanılır.
  - `Escape` tuşuna basıldığında güvenle kapanır (`isLoading` sırasında kapanma engellenir).
  - İşlem sürerken onay butonu içinde animasyonlu spinner gösterilir.

```tsx
<ConfirmModal
  isOpen={showDeleteModal}
  onClose={() => setShowDeleteModal(false)}
  onConfirm={handleDelete}
  title="Geçmişi Temizle"
  message="Tüm izleme geçmişiniz kalıcı olarak silinecektir. Bu işlem geri alınamaz."
  confirmText="Evet, Temizle"
  isDestructive={true}
  isLoading={isDeleting}
/>
```

### Kimlik Doğrulama: `AuthModal`
- **Dosya:** [`koup-app/src/components/AuthModal.tsx`](../koup-app/src/components/AuthModal.tsx)
- **Ne İşe Yarar:** Giriş Yapma ve Kayıt Olma akışını tek bir akıcı cam modal içinde birleştirir.
- **Özellikler:**
  - Supabase Auth hatalarını temiz Türkçeye çeviren `translateAuthError()` filtresi.
  - İstemci tarafı brute-force koruması: Hatalı deneme sayacı (`failedAttempts`) ve geçici kilitlenme sayacı (`lockoutSec`).
  - Onaylanmamış e-posta adresi tespitinde dahili yeniden onay bağlantısı gönderme (`resendCooldown`).
  - Şifre göster/gizle toggle'ı.

### Sayfalama: `Pagination`
- **Dosya:** [`koup-app/src/components/Pagination.tsx`](../koup-app/src/components/Pagination.tsx)
- **Ne İşe Yarar:** Keşfet, kütüphane, geçmiş, oyuncular ve arama sayfalarında sayfalama standardını kurar.
- **Özellikler:**
  - "Toplam 24.700 yapımdan 1 - 36 arası gösteriliyor (Sayfa 1 / 687)" bilgi göstergesi.
  - İlk Sayfa (`ChevronsLeft`), Önceki (`ChevronLeft`), Numaralı Butonlar (aktif olan parlak mavi `glow-blue`), Sonraki (`ChevronRight`) ve Son Sayfa (`ChevronsRight`).
  - Sayfa değiştiğinde yumuşak biçimde yukarı kaydırma (`scrollToTop = true, scrollToOffset = 180`).
  - `React.memo` ile gereksiz yeniden çizimler engellenmiştir.

### Modal, Popover ve Backdrop Mimarisi
- Tüm modallar `fixed inset-0 z-[999999]` katmanında açılır.
- Arka plan karartması (Backdrop): `bg-black/80` ve `backdrop-blur-sm`, `opacity: 0 -> 1` animasyonuyla girer.
- Modal kartı: `scale: 0.94, y: 12 -> scale: 1, y: 0` Apple spring eğrisiyle (`damping: 26, stiffness: 320`) merkezlenir.
- Arka plana tıklandığında veya `ESC` tuşuna basıldığında animasyonla kapanır.


---

## 6. Tüm Bileşenlerin Kapsamlı Kataloğu (31 Bileşen)

### AccordionMediaCard
- **Dosya:** [`koup-app/src/components/AccordionMediaCard.tsx`](../koup-app/src/components/AccordionMediaCard.tsx)
- **Amaç:** Ana sayfa, Keşfet ve profil sayfalarında kullanılan, fare üzerine geldiğinde pürüzsüzce genişleyen (accordion expand) ve canlı video fragmanı oynatan amiral gemisi vitrin kartıdır.
- **Props:** `item: MediaItem`, `rank?: number`, `priority?: boolean`, `fluidWidth?: boolean`, `overlayAnchor?: 'left' | 'right' | 'center'`.
- **Nerede Kullanılır:** `HomeClient.tsx`, `kesfet/page.tsx`, `profil/[username]/page.tsx`, `oyuncu/[slug]/page.tsx`, `listeler/[id]/page.tsx`.
- **Önemli Davranış:**
  - **O(1) Koordineli Hover:** Sayfada yüzlerce kart olsa bile `broadcastAccordionHover()` mimarisi sayesinde yalnızca o anda kapanan kart ile yeni açılan kart tetiklenir; sıfır bellek sızıntısı ve sıfır yeniden render maliyeti sağlanır.
  - **Drag Lock Koruması:** Kullanıcı yatay rayı fareyle veya dokunarak sürüklerken (`useDragScroll`) kartların yanlışlıkla hover açılması `isDragLocked` bayrağı ile kilitlenir.
  - **Dahili Aksiyonlar:** "İzle" (en son kalınan bölüme veya 1. bölüme tek tıkla geçiş), "Favori", "Takip", "Listeye Ekle" (`AddToListModal`).

### DirectMediaCard
- **Dosya:** [`koup-app/src/components/DirectMediaCard.tsx`](../koup-app/src/components/DirectMediaCard.tsx)
- **Amaç:** Akordiyon genişlemesi gerektirmeyen, hafif (lightweight) ve hızlı yüklenen doğrudan afiş kartıdır.
- **Props:** `item: MediaItem`, `priority?: boolean`.
- **Nerede Kullanılır:** `HomeClient.tsx` (Son Eklenen Yapımlar ve hızlı listeler).
- **Önemli Davranış:** Afiş görselini `getProxiedImageUrl` ile çeker, mevcut bölüm sayısını ve puan rozetini gösterir; tıklandığında doğrudan `/seri/[slug]` sayfasına yönlendirir.

### Navbar
- **Dosya:** [`koup-app/src/components/Navbar.tsx`](../koup-app/src/components/Navbar.tsx)
- **Amaç:** Tüm sayfalarda en üstte sabit duran mat cam menü çubuğudur (`.liquid-glass-bar`).
- **Nerede Kullanılır:** `layout.tsx` içinde global olarak kullanılır.
- **Önemli Davranış:**
  - **Anlık Canlı Arama:** Arama kutusuna odaklanıldığında çubuk genişler (`.navbar-search-bar:focus-within`), yazılan sorguyu Türkçe karakter duyarsızlaştırarak anında Supabase önbelleğinde arar ve açılır pencerede sonuçları listeler.
  - **Bildirim Rozeti ve Çekmecesi:** Okunmamış bildirim sayısını gösterir, tıklandığında son bildirimleri ses efektiyle listeler.
  - **Kullanıcı Menüsü:** Giriş yapılmamışsa "Giriş Yap" butonu (`AuthModal`), giriş yapılmışsa avatar, kütüphane kısayolları ve çıkış yap seçeneği sunar.
  - **Mobil Çekmece:** Mobilde hamburger menü ve ekranın altına oturan dokunmatik gezinme barı açar.

### Footer
- **Dosya:** [`koup-app/src/components/Footer.tsx`](../koup-app/src/components/Footer.tsx)
- **Amaç:** Site alt bilgi alanı, telif beyanı, bağımsız sinema manifestosu ve kurumsal linkleri sunar.
- **Nerede Kullanılır:** `layout.tsx` içinde global olarak kullanılır.
- **Önemli Davranış:** `[content-visibility:auto]` ve `[contain-intrinsic-size:auto_450px]` CSS kurallarıyla kullanıcı sayfanın en altına inene kadar render edilmeyerek ilk açılış performansını (LCP) artırır.

### EpisodeRail
- **Dosya:** [`koup-app/src/components/EpisodeRail.tsx`](../koup-app/src/components/EpisodeRail.tsx)
- **Amaç:** İzleme sayfasında video oynatıcının yanında veya altında çalışan bölüm seçim rayıdır.
- **Props:** `mediaSlug`, `mediaTitle`, `mediaId`, `episodes`, `currentSeason`, `currentEpNum`, `seasons`, `watchedEpisodes`, `onSelectEpisode`, `onToggleWatched`, `onSelectSeason`.
- **Nerede Kullanılır:** `seri/[slug]/[episode]/page.tsx`.
- **Önemli Davranış:**
  - Sezon geçişi için `CustomSelect` kullanır.
  - O anda izlenen bölümü tespit edip listeyi otomatik olarak o bölüme kaydırır (`scrollIntoView`).
  - Bölümler üzerinde tek tıkla "İzlendi" durumunu açıp kapatma checkmark'ı sunar.
  - Masaüstünde video oynatıcının yüksekliğiyle pürüzsüzce senkronize olur (`.player-synced-height`).

### FranchiseWatchOrder
- **Dosya:** [`koup-app/src/components/FranchiseWatchOrder.tsx`](../koup-app/src/components/FranchiseWatchOrder.tsx)
- **Amaç:** Birbirine bağlı dizi evrenlerinin (örneğin Reply serisi, Fate evreni, Donghua evrenleri) doğru izleme sırasını gösteren kronolojik zaman çizelgesidir.
- **Props:** `franchise: FranchiseData`, `currentMediaId: number`.
- **Nerede Kullanılır:** `seri/[slug]/SeriesDetailClient.tsx` ve `seri/[slug]/[episode]/page.tsx`.
- **Önemli Davranış:** "Ana Seri", "Yan Hikayeler & Filmler" ve "Tümü (Kronolojik)" sekmeleri arasında geçiş sağlar; o anda izlenen yapımı parlak mavi çerçeveyle vurgular.

### Top10Numeral
- **Dosya:** [`koup-app/src/components/Top10Numeral.tsx`](../koup-app/src/components/Top10Numeral.tsx)
- **Amaç:** Netflix tarzı haftalık Top 10 dizi ve film raylarında posterlerin soluna yerleşen büyük konturlu (outline) sıra numaralarını çizer.
- **Props:** `rank: number` (1-10), `className?: string`.
- **Nerede Kullanılır:** `HomeClient.tsx` (Top 10 Diziler ve Top 10 Filmler rayları).
- **Önemli Davranış:** Android Roboto veya WebKit tarayıcılarında standart CSS `text-stroke` özelliğinin 3, 4, 6, 8, 9 rakamlarında yarattığı iç içe geçme ve çirkin köşe deformasyonlarını engellemek için saf SVG vektör yolu (`GLYPH_PATHS`) kullanır.

### WikiBioText
- **Dosya:** [`koup-app/src/components/WikiBioText.tsx`](../koup-app/src/components/WikiBioText.tsx)
- **Amaç:** Oyuncu sayfalarındaki Wikipedia ve MyDramaList kaynaklı biyografi metinlerini zenginleştiren anlamsal metin ayrıştırıcısıdır.
- **Props:** `text: string`, `actorName?: string`, `credits?: CastMember[]`, `knownTitles?: string[]`.
- **Nerede Kullanılır:** `oyuncu/[slug]/page.tsx`.
- **Önemli Davranış:** Biyografi metni içindeki dizi isimlerini ve rol arkadaşlarını otomatik olarak tespit ederek interaktif bağlantılara dönüştürür. Fare kelimenin üzerine getirildiğinde anında küçük afiş, puan ve izleme linki içeren cam popover açar.

### CountryFlag
- **Dosya:** [`koup-app/src/components/CountryFlag.tsx`](../koup-app/src/components/CountryFlag.tsx)
- **Amaç:** İşletim sistemlerinin bayrak emojilerini farklı çizmesini (özellikle Windows'un bayrak emojisi desteklemeyip iki harfli metin göstermesini) engelleyerek tüm cihazlarda yüksek çözünürlüklü SVG bayrak gösterir.
- **Props:** `code?: string | null` (KR, JP, CN, TH, TW, TR, US, GB vb.), `size?: 'sm' | 'md' | 'lg'`.
- **Nerede Kullanılır:** `Navbar`, `HomeClient`, `kesfet`, `seri/[slug]`, `oyuncular`, `CustomSelect`.

### CookieConsentBanner
- **Dosya:** [`koup-app/src/components/CookieConsentBanner.tsx`](../koup-app/src/components/CookieConsentBanner.tsx)
- **Amaç:** KVKK / GDPR standartlarında çerez onayını ve KoUp Zevk Profili kişiselleştirme tercihlerini yönetir.
- **Nerede Kullanılır:** `layout.tsx` içinde global çalışır.
- **Önemli Davranış:** Kullanıcı henüz karar vermemişse sayfa açılışından 900ms sonra ekranın altında cam bildirim çubuğu olarak belirir. "Özelleştir" tıklandığında analitik ve kişiselleştirme ayarlarını açar. `koup:open-cookie-modal` event'i ile ayarlardan tekrar açılabilir.

### AddToListModal
- **Dosya:** [`koup-app/src/components/AddToListModal.tsx`](../koup-app/src/components/AddToListModal.tsx)
- **Amaç:** Bir diziyi veya filmi kullanıcının mevcut özel listelerine eklemesini veya doğrudan yeni bir liste oluşturup içine atmasını sağlayan hızlı yönetim penceresidir.
- **Props:** `isOpen: boolean`, `onClose: () => void`, `media: MediaItem`.
- **Nerede Kullanılır:** `AccordionMediaCard`, `SeriesDetailClient`.
- **Önemli Davranış:** Kullanıcı listelerini modül düzeyinde önbelleğe alır (`cachedUserLists`); bu sayede modal her açıldığında tekrar yükleniyor animasyonu göstermez, anında listeyi doldurur.

### PageTransition & ScrollRestoration
- **Dosyalar:** [`PageTransition.tsx`](../koup-app/src/components/PageTransition.tsx) ve [`ScrollRestoration.tsx`](../koup-app/src/components/ScrollRestoration.tsx)
- **Amaç:** Sayfa geçişlerinde ekran titreşimini önlemek ve geri dönüşlerde kullanıcının kaydırma pozisyonunu milimetrik korumak.
- **Nerede Kullanılır:** `layout.tsx`.
- **Önemli Davranış:** `window.history.scrollRestoration = 'manual'` moduna alarak tüm tıklamaları ve popstate geçişlerini `history.state.__koup_scrollY` ve `sessionStorage` üzerinde saklar; `useDeferredMount` ile senkronize çalışarak sayfa geri yüklendiğinde elemanların doğru konuma oturmasını sağlar.

### ShortsRail & ShortsCard
- **Dosyalar:** [`koup-app/src/components/home/ShortsRail.tsx`](../koup-app/src/components/home/ShortsRail.tsx) ve [`koup-app/src/components/shorts/ShortsCard.tsx`](../koup-app/src/components/shorts/ShortsCard.tsx)
- **Amaç:** Dikey kısa drama yapımlarını 9:16 oranında sinematik afişlerle vitrinde ve arama sonuçlarında sergiler.
- **Nerede Kullanılır:** `HomeClient.tsx`, `kesfet/page.tsx`.
- **Önemli Davranış:** `ShortsCard` tıklandığında doğrudan ilgili kısa dramanın dikey oynatıcı rotasına (`/seri/[slug]/1`) atlar.

---

### Oynatıcı Bileşenleri Özeti
*(Bu bileşenlerin video motoru, HLS çözümleyicisi ve derin teknik detayları [05-oynatici-ve-yayin-akisi.md](./05-oynatici-ve-yayin-akisi.md) dokümanında incelenmiştir).*
- **`NetflixPlayer.tsx`:** Apple TV+ & Netflix kalitesinde donanım hızlandırmalı HLS video oynatıcısı. Otomatik kalite adaptasyonu, fansub seçimi, sinema ışıkları modu ve tuş kontrollerini yönetir.
- **`NetflixEpisodePopover.tsx`:** Oynatıcı üzerinde fare gezdirildiğinde zaman damgalı kare ve bölüm önizlemesini sunan popover kartı.
- **`shorts/ShortsWatchClient.tsx`:** Mobil Reels/TikTok akışında tam ekran dikey video oynatıcı motoru. Yukarı/aşağı kaydırmayla bölüm atlama ve ses kontrollerini barındırır.

---

### Topluluk & Yorum Bileşenleri Özeti
*(Bu bileşenin detaylı API ve moderasyon özellikleri [10-kullanici-ozellikleri.md](./10-kullanici-ozellikleri.md) dokümanında incelenmiştir).*
- **`RichCommentSection.tsx`:** Dizi, bölüm, magazin ve oyuncu sayfalarının altına iliştirilen zengin yorum motorudur. Kalın/italik metin, spoiler koruması (`has_spoiler`), videonun saniyesine tıklayarak atlama (`timestamp_sec`), GIF arama ve yanıtlama ağacını yönetir.

---

### Admin Yönetim Bileşenleri Tablosu
*(Bu bileşenlerin kimlik yetkilendirmesi ve arka uç API bağlantıları [07-kimlik-yetki-ve-guvenlik.md](./07-kimlik-yetki-ve-guvenlik.md) dokümanında incelenmiştir).*

| Bileşen Dosyası | Yönetim Görevi |
|---|---|
| [`AdminAutomationCenter.tsx`](../koup-app/src/components/AdminAutomationCenter.tsx) | Kazıyıcı (Scraper) çalıştırma, cron zamanlaması ve son senkron durumu. |
| [`AdminSeriesAutomation.tsx`](../koup-app/src/components/AdminSeriesAutomation.tsx) | Animecix ve dış platformlardan otomatik bölüm ve fansub senkronizasyonu. |
| [`AdminSeriesSync.tsx`](../koup-app/src/components/AdminSeriesSync.tsx) | Tekil dizi/film düzeyinde bölüm ekleme, HLS kaynak atama ve fansub adı düzenleme. |
| [`admin/AdminMaintenanceHub.tsx`](../koup-app/src/components/admin/AdminMaintenanceHub.tsx) | Veritabanı bakımı, R2 yedekleme, önbellek temizleme ve kırık link taraması. |
| [`admin/AdminMatchQueue.tsx`](../koup-app/src/components/admin/AdminMatchQueue.tsx) | Kazıyıcılardan gelen otomatik yapım eşleşmelerini onaylama ve birleştirme (merge). |
| [`admin/AdminSeriesRequests.tsx`](../koup-app/src/components/admin/AdminSeriesRequests.tsx) | Kullanıcı dizi isteklerini onaylama, reddetme veya siteye aktarma. |
| [`admin/AdminSettingsAndAudit.tsx`](../koup-app/src/components/admin/AdminSettingsAndAudit.tsx) | Sistem ayarları, güvenlik limitleri ve yönetici denetim logları (Audit Trail). |

---

## 7. Önemli UI Hook'ları Özeti

*(Hook'ların tam kaynak kodu ve çalışma döngüsü detayları [11-state-hooklar-ve-kutuphaneler.md](./11-state-hooklar-ve-kutuphaneler.md) dokümanında açıklanmıştır).*

1. **`useDragScroll` ([`koup-app/src/hooks/useDragScroll.ts`](../koup-app/src/hooks/useDragScroll.ts)):**
   - Masaüstünde yatay rayları fareyle tutup sürükleyerek kaydırmayı sağlar.
   - 120 FPS akıcılık için `requestAnimationFrame` senkronizasyonunu kullanır, farenin bırakılma hızına (velocity) göre pürüzsüz momentum ataleti uygular.
   - Sürükleme başladığında kart hover'larını kilitler (`setAccordionDragLock(true)`).
2. **`usePillDragTracking` ([`koup-app/src/hooks/usePillDragTracking.ts`](../koup-app/src/hooks/usePillDragTracking.ts)):**
   - Kategori ve sekme çubuklarında aktif seçeneği ekranın tam ortasına pürüzsüzce hizalar (`centerTabInContainer`).
   - Mobilde dokunmatik swipe hareketini engellemezken, masaüstünde fareyle sürükleyerek sekme değiştirme olanağı tanır.
3. **`useDeferredMount` ([`koup-app/src/hooks/useDeferredMount.ts`](../koup-app/src/hooks/useDeferredMount.ts)):**
   - Ana sayfadaki ekran dışı rayların tarayıcıyı dondurmasını önler.
   - İlk 3 bölümü (`order <= 2`) hemen yükler; altındaki rayları `requestIdleCallback` ve 400px mesafeli `IntersectionObserver` ile sırayla ekrana basar.

---

## 8. Yeni UI Bileşeni Eklerken Kontrol Listesi

KoUp projesine yeni bir bileşen yazacak her geliştirici veya alt ajan şu kontrol listesine tavizsiz uymalıdır:

- [ ] **1. Tasarım Tutarlılığı:** Bileşen sitenin genel sinematik karanlık kimliğine (`#080808`, `#0f0f11`, `apple-glass`, `glass-pill`) %100 uyuyor mu? Başka bir projeden kopyalanmış gibi yabancı duruyor mu?
- [ ] **2. `<select>` Yasağı:** Form veya seçim alanında tarayıcının yerel `<select>` etiketi yerine kesinlikle [`CustomSelect`](../koup-app/src/components/CustomSelect.tsx) kullanıldı mı?
- [ ] **3. Ortak Primitifler:** Girdi için `KoupInput`, onay için `ConfirmModal`, sayfalama için `Pagination` kullanıldı mı? Sıfırdan mükerrer bileşen yazıldı mı?
- [ ] **4. Açılış/Kapanış Animasyonu:** Açılan veya kapanan katmanlarda `motion` veya GPU dostu `transform/opacity` animasyonu var mı? Aniden belirip kaybolma engellendi mi?
- [ ] **5. Mobil Dokunma Hedefi:** Buton ve tıklanabilir alanların etkin boyutu en az **44x44px** mi?
- [ ] **6. Sıfır Yatay Taşma:** Bileşen mobilde ekran dışına taşıp yatay kaydırma çubuğu çıkarıyor mu? (`overflow-x` kontrolü yapıldı mı?)
- [ ] **7. Az Yazı, Çok Görsel (No Text-Heavy):** Kullanıcıyı boğan uzun açıklama paragrafları yerine temiz ikonlar, rozetler ve poster odaklı hiyerarşi kuruldu mu?
- [ ] **8. Sıfır Sabit Anahtar (Zero Hardcoded Secret):** Bileşenin içine doğrudan API anahtarı, token veya hassas veritabanı değişkeni gömülmedi mi?
- [ ] **9. Bellek Temizliği:** `useEffect` içindeki listener, timer veya observer unmount anında temizleniyor mu?

---

## 9. İlgili Dokümanlar

- [Sayfalar ve Rotalar (03-sayfalar-ve-rotalar.md)](./03-sayfalar-ve-rotalar.md) — 26 sayfanın URL ve veri akışı mimarisi.
- [Oynatıcı ve Yayın Akışı (05-oynatici-ve-yayin-akisi.md)](./05-oynatici-ve-yayin-akisi.md) — NetflixPlayer ve ShortsWatchClient oynatıcı detayları.
- [Kimlik, Yetki ve Güvenlik (07-kimlik-yetki-ve-guvenlik.md)](./07-kimlik-yetki-ve-guvenlik.md) — Admin paneli ve güvenlik kontrolleri.
- [Kullanıcı Özellikleri (10-kullanici-ozellikleri.md)](./10-kullanici-ozellikleri.md) — Yorum sistemi ve kullanıcı etkileşimleri.
- [State, Hook'lar ve Kütüphaneler (11-state-hooklar-ve-kutuphaneler.md)](./11-state-hooklar-ve-kutuphaneler.md) — `useDragScroll`, `usePillDragTracking`, `useDeferredMount` ve KoUpContext mimarisi.
- [Kurallar ve Yasaklar Rehberi (12-kurallar-ve-yasaklar.md)](./12-kurallar-ve-yasaklar.md) — Proje standartları, `<select>` yasağı ve mimari disiplin.
