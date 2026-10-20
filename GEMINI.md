# Proje Geliştirme Standartları & Prensipleri (GEMINI.md)

Bu kurallar, projede yapılan tüm kodlama, tasarım, refaktör ve mimari geliştirmelerde **kesinlikle uygulanacaktır**.

---

## 1. Arayüz Bütünlüğü & Tasarım Tutarlılığı (Design Consistency)
- **Var Olan Tasarıma Saygı:** Projede oturmuş bir UI/UX dili, tema (karanlık mod/sinematik stil vb.) ve renk paleti vardır. Yeni eklenen hiçbir bileşen "başka bir projeden kopyalanmış gibi" veya ayrı bir kafadan çıkmış gibi durmayacaktır.
- **Yeniden Kullanılabilir Bileşenler:** Sitede tanımlanmış hazır bileşenler varken sıfırdan veya farklı tarzda bileşenler yazılmayacaktır:
  - **Dropdown/Select:** Tarayıcının varsayılan `<select>` etiketi **asla** kullanılmayacaktır. Projede tanımlanmış olan özel dropdown/select bileşeni nerede olursa olsun tutarlı biçimde kullanılacaktır.
  - **Butonlar ve Girdiler:** Sitenin kendine ait buton, input ve form standartları kullanılacaktır; her sayfada farklı buton/input tarzları türetilmeyecektir.
  - **Modallar & Katmanlar:** Sitenin mevcut modal mimarisi, popover ve backdrop efektleri korunacaktır.

---

## 2. Animasyonlar & Modern UI/UX (Motion & Smart Design)
- **Akıcı Açılış/Kapanış Animasyonları:** Tüm açılır menüler, modallar, popoverlar, bildirimler ve geçişlerde mutlaka açılış ve kapanış animasyonları bulunmalıdır.
- **Hız ve Zarafet:** Animasyonlar hantal veya yavaş olmayacak; hızlı, sezgisel ve modern hissettirecektir. Özel etkileşim gerektiren yerlerde daha zengin mikro-etkileşimler tasarlanacaktır.
- **Zeki ve Modern Düşünce:** Eski kafalı, durağan ve hantal UI kalıpları reddedilecek; modern dijital ürün ve streaming deneyimi kalitesi hedeflenecektir.

---

## 3. %100 Mobil Uyum & Responsive Tasarım
- **Mobile-First Düşünce:** Arayüze eklenen her özellik, bileşen ve sayfa mutlaka mobil cihazlarda, tabletlerde ve masaüstünde kusursuz görünecek şekilde tasarlanacaktır.
- **Dokunma ve Alan Optimizasyonu:** Mobilde taşma (overflow), yatay kayma hataları engellenecek, dokunma hedefleri (touch target) parmak kullanımına uygun olacaktır.

---

## 4. Full-Stack Güvenlik & Defansif Kodlama
- **Ön Uç ve Arka Uç Birlikte:** Bir özellik getirilirken sadece arayüzü değil, API, edge servisler, veritabanı uçları da eş zamanlı ele alınacaktır.
- **Açıklara Sıfır Tolerans:**
  - SQL Injection, XSS ve güvensiz doğrudan nesne referansları (IDOR) engellenecektir.
  - API uç noktalarında yetkilendirme (auth check) ve girdi doğrulama (input validation) eksiksiz yapılacaktır.
  - Güvenlik açığı yaratabilecek hiçbir varsayım yapılmayacaktır.

---

## 5. Performans, Rate Limiting & Veritabanı Koruma
- **Veritabanını Şişirmemek ve Patlatmamak:**
  - Kontrolsüz sorgular, N+1 problemleri ve gereksiz kolon/tablo şişirmelerinden kaçınılacaktır.
  - API uçlarına ve arama/filtreleme sorgularına mantıklı limitler (`limit`, `pagination`, `debounce`) konulacaktır.
  - Cache mekanizmaları (CDN/Edge, object storage, client-side memoization) aktif olarak düşünülerek DB yükü minimize edilecektir.

---

## 6. Araçlar, MCP ve Skill Kullanımı (Özellikle REA)
- Görevin gerektirdiği MCP sunucuları ve skill'ler eksiksiz ve proaktif şekilde kullanılacaktır:
  - Tersine mühendislik, API analizi ve veri akışı çözümlemelerinde **REA (Reverse Engineer Anything)** ve ilgili analiz araçları öncelikli kullanılacaktır.
  - İlgili bulut ve platform MCP araçları yerinde ve doğru parametrelerle kullanılacaktır.
  - Web araştırmaları ve modern standartlar için uygun skill'ler devreye sokulacaktır.

---

## 7. Kod Kalitesi & Okunabilirlik
- Kodlar modüler, temiz, kendini açıklayan değişken/fonksiyon adlarıyla yazılacaktır.
- Tip güvenliği korunacak, gereksiz gevşek tiplerden (`any` vb.) kaçınılacaktır.
- Var olan dokümantasyon ve yorum satırları bozulmayacaktır.

---

## 8. Çalışma Alanı Temizliği (Proje İçi Çöp Bırakmama)
- **Tek Kullanımlık Dosyaları Silme:** Görev sırasında oluşturulan geçici test scriptleri, tek kullanımlık analiz/kazıma dosyaları, geçici log veya dump dosyaları iş bittiğinde **mutlaka silinecektir**.
- Proje kökünde ve alt klasörlerde gereksiz kalabalık, atıl dosya ve çöp kod asla bırakılmayacaktır.

---

## 9. %100 Dürüstlük, Doğrulama & Görevi Sonuna Kadar Bitirme (No Fake Success)
- **Asla Yalan Söylememek & Kendini Kandırmamak:** Bir özellik, endpoint veya bileşen test edilip çalıştığı doğrulanmadan asla "çalışıyor", "tamamlandı" denmeyecektir. Çalışmayan, eksik veya varsayıma dayalı hiçbir durum gizlenmeyecek; ne varsa dürüstçe ortaya konulacaktır.
- **Yüzeysel/Yarım Bırakma Yok:** Bir görev verildiğinde işin ucu açık bırakılmayacak; %100 odaklanılarak baştan sona, eksiksiz ve tam fonksiyonel şekilde teslim edilecektir.
- **Gerçek Doğrulama:** Kod yazıldıktan sonra gerçekten derlendiği, hata vermediği ve çalıştığı terminal çıktıları ve kontrollerle teyit edilecektir.

---

## 10. Çoklu Dağılımlı İşlerde Subagent ve Model Ayrımı
- **Paralel & Dağıtık Görevler:** Geniş kapsamlı araştırma, çoklu dosya tarama, toplu veri analizi ve ayrık iş parçacıklarında ana bağlamı kirletmemek ve işi hızlandırmak için gerektiğinde alt ajanlar (`invoke_subagent`) proaktif olarak devreye sokulacaktır.
- **Göreve Göre Model Ayrımı (Önemli):**
  - **Kod Yazımı & Refaktör:** Alt ajana kod yazdırılacak veya dosya düzenlenecekse kesinlikle en az `flash` modeli tercih edilecektir.
  - **Araştırma & Basit İşler:** `flash_lite` modeli **asla** kod yazımı için kullanılmayacak; yalnızca salt okuma, log/dosya tarama, basit web aramaları ve bilgi toplama gibi aşırı basit/hafif işlerde kullanılacaktır.

---

## 11. Arşiv Düzeltmeleri, R2 ve Supabase Eşitleme Zorunluluğu (Full Storage Sync)
- **Arşivde Düzeltme Sonrası Tam Senkronizasyon Zinciri:** Yerel arşiv veritabanında (`webdrama_archive.db`) yapılan herhangi bir veri düzeltme, temizleme (purge), kaynak onarımı (heal), tekilleştirme (merge) veya yeni ekleme işlemi sonrasında yalnızca yerel veritabanında kalmak kesinlikle yasaktır. Yapılan değişiklikler anında depolama ve bulut katmanlarına yansıtılacaktır:
  - **Cloudflare R2 Veritabanı Dosyası (DB Sync):** Yerel SQLite veritabanı WAL checkpoint yapıldıktan sonra R2 üzerindeki `db/webdrama_archive.db` konumuna eksiksiz yüklenmeli/yedeklenmelidir (`backup_db_to_r2()`).
  - **Cloudflare R2 Arşiv Klasörleri & JSON Paketleri (Bundles Sync):** Güncellenen veya etkilenen yapımların kaynak JSON paketleri (`r2_bundles/sources/{id}.json`) yeniden dışa aktarılmalı (`scripts/export_sources_bundles.py`) ve R2'ye yüklenmelidir (`scripts/upload_to_r2.py`).
  - **Supabase Senkronizasyonu (Supabase Sync):** Arşiv üzerinde yapılan değişiklikler aynı şekilde Supabase tarafına da yansıtılmalı (`media`/`dramas`, `episodes` tabloları güncellenmeli veya `scripts/sync_all_episodes_to_supabase.py` ile eşitlenmelidir).
- **Asla Desenkronize / Eksik Bırakmama:** Bir arşiv düzeltmesi yapıldığında yerel DB, R2 veritabanı, R2 arşiv paketleri ve Supabase olmak üzere zincirin tüm halkaları güncellenmeden görev "tamamlandı" sayılmayacaktır.

---

## 12. Geliştirme Sunucusu ve Derleyici Bütünlüğü (Dev Server & Build Lifecycle)
- **Çalışan Sunucu Varken Build Çakışmasını Engelleme:** Next.js geliştirme sunucusu (`npm run dev`) çalışırken aynı anda `npm run build` veya benzeri derleme araçları çalıştırıldığında `.next` önbelleği ve derleme dosyaları bozulmakta, sunucu kilitlenmekte veya runtime hatalarına düşmektedir.
- **Kapatıp Tekrar Başlatma Kuralı:** Eğer site/geliştirme sunucusu çalışır durumdayken `npm run build` veya tam derleyici araçları kullanılacaksa:
  1. Çalışan geliştirme sunucusu **önce güvenli bir şekilde kapatılacaktır**.
  2. Derleme / build işlemi tamamlanıp hatalar kontrol edilecektir.
  3. İşlem bittikten sonra sunucu **tekrar temiz bir şekilde başlatılacaktır**.
- **Hafif Tip Kontrolü Alternatifi:** Yalnızca TypeScript ve sözdizimi hatalarını derleme önbelleğini bozmadan kontrol etmek için öncelikle `npx tsc --noEmit` tercih edilebilir; tam `npm run build` çalıştırıldığında ise sunucuyu kapatıp yeniden başlatma adımı tavizsiz uygulanacaktır.

