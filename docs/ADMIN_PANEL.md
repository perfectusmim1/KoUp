# Yönetim Paneli Mimarisi & AdminMediaPicker

KoUp yönetim paneli (`/admin`), platformun içerik otomasyonunu, katalog bakımını, topluluk seri isteklerini ve sistem sağlığını yöneten merkezi operasyon merkezidir.

---

## 1. Yönetim Paneli Sekme Haritası

- **Bakım & Onarım Hub (`AdminMaintenanceHub`):** Eksik bölümleri otomatik tarayıp onarma (Auto-Heal Archive Gaps), sağlayıcılardaki bekleyen kaynakları çözme (Recheck Pending), mükerrer yapımları birleştirme (Merge Duplicates), ölü kaynakları temizleme (Purge Dead Sources) ve takvim/Supabase/R2 senkronizasyon operasyonları.
- **Topluluk Seri İstekleri (`AdminSeriesRequests`):** Kullanıcıların AniList, TMDB, MyDramaList ve IMDb üzerinden talep ettiği serilerin incelenmesi, site içi katalogla eşleştirilip onaylanması veya reddedilmesi.
- **Seri Eşleme Kuyruğu (`AdminMatchQueue`):** Sağlayıcılardan gelen ham içeriklerin ana katalogdaki serilerle otomatik ve manuel eşleştirilmesi.
- **Seri Otomasyonu (`AdminSeriesAutomation`):** Hedef sitelerden otomatik bölüm takibi, cron periyotları ve yeni bölüm çekme görevleri.
- **Ayarlar, İnceleme & Bildirimler (`AdminSettingsAndAudit`):** Yayın duyuruları (Broadcast Notification), sistem sağlığı ve audit logları.

---

## 2. AdminMediaPicker Bileşeni

- **Konum:** `koup-app/src/components/admin/AdminMediaPicker.tsx`
- **Tasarım İlkesi:** Admin kullanıcılarının ezbere dizi ID'si (ör. `4238`) veya URL slug'ı (ör. `vincenzo-2021`) girmesi zorunluluğunu ortadan kaldırmak; sinematik afişli, anlık isimle ve ID ile aranabilen tek bir standart bileşen sunmak.

### Ne İşe Yarar?
Admin panelindeki tüm modüllerde (onarım araçları, seri istek onayları, bildirim hedefleme vb.) dizi/film/anime seçimini basitleştirir. Kullanıcı dizi adını yazmaya başladığı anda afişli sonuçları listeler; seçildiğinde kompakt bir kart (chip) olarak sabitler.

### Nasıl Çalışır?
1. **Debounce & Yarış Durumu (Race-Condition) Koruması:**
   - Tuş vuruşları 280ms debounce ile filtrelenir.
   - Her istek `searchSeqRef` sayaç kontrolüyle izlenir; yavaş gelen eski sorguların en son yazılan aramayı ezmesi engellenir.
2. **Sayısal ID ve İsim Araması Desteği:**
   - Eğer arama terimi yalnızca rakamlardan oluşuyorsa (`/^\d+$/`), doğrudan `public.media` tablosundan `id` eşleşmesi sorgulanır ve listenin en başına eklenir (eski ID alışkanlığı korunur).
   - Metin aramalarında öncelikle Supabase `search_catalog` PostgreSQL RPC fonksiyonu (`p_query`, `p_limit: 20`) çağrılır.
   - Sonuçlar `rankSearchResults` algoritması ile başlık tam eşleşmesi, başlangıç eşleşmesi, puan ve bölüm sayısına göre sıralanır.
   - RPC'nin boş dönmesi veya erişilememesi durumunda `title.ilike`, `slug.ilike` ve `native_title.ilike` indeksli fallback devreye girer.
3. **Neden Canlı Site Scraper Arama Endpoint'i Kullanılmadı?**
   - `/api/admin/series-automation/search` ucu dış sitelere (Dizipal, AsyaWatch vb.) canlı scraper istekleri gönderebilir; bu işlem 3 ila 8 saniye sürer ve harici sitelerde rate-limit/engelleme riski taşır.
   - `search_catalog` RPC ise yerel veritabanında indeksli trigram araması yapar, 20-50 milisaniyede kesin ve kararlı sonuç döner.
4. **Seçim & Chip Görünümü:**
   - Dizi seçildiğinde arama kutusu yerini afiş, başlık, içerik türü, çıkış yılı, dizi ID'si (`#123`) ve temizleme (`X`) butonu içeren şık bir çipe bırakır.
5. **Klavye Erişilebilirliği & Mikro Etkileşimler:**
   - `ArrowDown` ve `ArrowUp` tuşlarıyla sonuçlar arasında gezinilebilir, `Enter` ile odaklanmış dizi seçilir, `Escape` ile açılır menü kapatılır.
   - Dropdown menüsü `motion/react` `AnimatePresence` ile yumuşak fade + slide animasyonuyla açılıp kapanır.
   - Dışarı tıklama `pointerdown` dinleyicisi ile tespit edilir ve unmount sırasında temizlenir (`cleanup`).
6. **Hızlı Öneri (Quick Recommendation):**
   - `initialQuery` prop'u verildiğinde (örneğin topluluk isteklerindeki dizi adı), kutu boşken "Öneriyle ara: [Dizi Adı]" tıklanabilir öneri çipi sunularak tek tıkla arama yapılması sağlanır.

---

## 3. Kullanıldığı Yerler

1. **`koup-app/src/components/admin/AdminMaintenanceHub.tsx`:**
   - **Eksik Bölüm Onarıcı (Card A):** `healDramaId` girdi kutusu yerine `AdminMediaPicker` entegre edildi. Boş bırakıldığında tüm katalogdaki eksikler taranır; bir dizi seçildiğinde yalnızca o dizinin eksik bölümleri onarılır.
   - **Bekleyen Kaynak Çözücü (Card B):** `pendingDramaId` girdi kutusu yerine `AdminMediaPicker` entegre edildi. Belirli bir sağlayıcıdaki bekleyen bölümler hedeflenerek tek dizi bazında veya genel çalıştırılabilir.
2. **`koup-app/src/components/admin/AdminSeriesRequests.tsx`:**
   - **Topluluk Seri İstekleri Eşlemesi:** Eski düz metin `Site İçi Seri Slug` input'u yerine `AdminMediaPicker` eklendi. Admin, talep edilen seriyi katalogda anında arayıp afişiyle seçebilir; seçilen serinin `slug` ve `id` değerleri doğrudan API PATCH isteğine bağlanır.

---

## 4. Kısıtlar ve Kurallar

- **Native `<select>` Yasağı:** Arayüzde hiçbir zaman tarayıcının varsayılan `<select>` etiketi kullanılmaz. Özel dropdown veya `CustomSelect` kullanılır.
- **Dokunma Hedefleri (Touch Targets):** Mobil cihazlarda tıklanabilir tüm öğeler (sonuç butonları, temizleme butonları) minimum 44x44px erişilebilirlik standardına uygundur.
- **Sıfır Hardcoded Secret:** Bileşen yalnızca standart istemci tarafı Supabase anon anahtarını (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) kullanır; hiçbir backend rol anahtarı veya servis token'ı istemciye sızdırılmaz.

---

## 5. Seri Otomasyonu Kart Düzeni & Türkçe Slugify (`AdminSeriesAutomation`)

- **Dosya:** `koup-app/src/components/AdminSeriesAutomation.tsx`
- **Sorun:** 19 adet scraper kaynak sitesi butonunun hepsi tek bir yatay flex satırında listeleniyordu. Bu durum poster ve başlık/istatistik bloğunu dar (~150px) bir sütuna sıkıştırıyor; "44 Bölüm • 37 Kaynak" ve son tarama metinlerinin kelime kelime dikey kırılmasına ve butonların birbirine girmesine yol açıyordu.
- **Çözüm:**
  1. **2 Seviyeli Hiyerarşik Kart:**
     - **Üst Satır:** Büyütülmüş poster (`w-14 h-20`), soluk `#media_id` rozeti, belirgin başlık, yayın durumu ve yatayda kırılmayan (`whitespace-nowrap`) istatistik satırı. Sağda "Otomasyon Açık/Kapalı", "Şimdi Çapraz Tara" ve silme aksiyonları.
     - **Alt Satır:** Sadece aktif bağlı siteler renkli chip olarak listelenir (tek tıkla `X` bağlantı kesme). Sağında "Slug Ayarları" ve `+ X Site Ekle` butonu yer alır.
  2. **Akordeon Kaynak Sitesi Tepsisi:**
     - `+ X Site Ekle` tıklandığında bağlı olmayan siteler `AnimatePresence` ile yumuşak animasyonla açılır; tıklandığı anda seriye bağlanır.
  3. **Türkçe Karakter Desteği (`slugifyTR`):**
     - Manuel seri ekleme ve slug çözümlerinde Türkçe karakterleri (`ç, ğ, ı, ö, ş, ü`) doğru ASCII karşılıklarına (`c, g, i, o, s, u`) dönüştüren `slugifyTR` fonksiyonu entegre edildi.

