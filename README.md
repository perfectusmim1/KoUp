# 🎬 KoUp — Yeni Nesil Sinema, K-Drama, C-Drama, Anime & Canlı Magazin Platformu

**KoUp**, K-Drama, C-Drama, Anime, Global Dizi/Filmler ve Canlı Asya Magazin/Dedikodu dünyasını **Apple TV+ (`tvOS / macOS Sequoia`)**, **Netflix** ve **MUBI** standartlarında bir araya getiren hibrit yayın ve katalog platformudur.

## ✨ Öne Çıkan Özellikler

- **Lumina Projection Arayüzü & Akordiyon Kartlar:** Üzerine gelindiğinde `2:3` posterden `16:9` geniş ekran sahne önizlemesine yay fiziğiyle açılan akordiyon kartlar ve koyu OLED (`#08080A`) atmosferi.
- **Çift Katmanlı KoUp Netflix Player (`NetflixPlayer.tsx`):**
  - **Katman 1 (Native HLS / MP4):** `DiziYou HLS`, `HDFilm HLS` ve `Tau-Video` (`1080p / 720p / 480p` doğrudan MP4 çözücü) için özel ilerleme çubuğu, `-10s/+10s`, hız/kalite seçimi, **İntroyu Atla (+85s)** ve **15sn Sonraki Bölüm Sayacı**.
  - **Katman 2 (Evrensel Üst Cam Kontrol Barı):** `OK.ru`, `VK`, `Vidmoly`, `Filemoon`, `Sibnet` dahil tüm kaynakların üzerinde çalışan oynatıcı-içi **Kaynak & Fansub Değiştirici**, **Sezon & Bölüm Çekmecesi**, **Apple TV+ InSight (Kadro & Karakterler)** ve **Sinema Modu**.
- **MyDramaList (MDL) + AniList + IMDb & TMDB Entegrasyonu:**
  - Asya dizileri için MDL, Animeler için AniList (karakterler ve Seiyuu dahil), Global yapımlar için IMDb & TMDB Türkçe özet ve 16:9 arka plan zenginleştirmesi.
  - **1-Tık MDL & AniList İzleme Listesi Aktarımı** (Şifre gerektirmeden açık profil üzerinden).
- **Oyuncular, Anime Karakterleri & Seiyuu Liderlik Tablosu (`/oyuncular`):**
  - 21.800+ oyuncu ve anime karakterinin en çok favori alandan (`❤️ favorites_count DESC`) en aza doğru sıralandığı liderlik tablosu, birlikte rol aldığı oyuncular (`Co-Star Ağı`), bildirim takibi (`🔔`) ve karakter/oyuncu yorumları.
- **Canlı AsyaMag Magazin & Dedikodu Entegrasyonu (`/magazin`):**
  - `https://asyamag.com/wp-json/wp/v2/posts?_embed=true` canlı API bağlantısı + Cloudflare Edge önbelleklemesi ile en güncel K-Drama, C-Drama, BL/GL ve Dedikodu haberlerini dış siteye çıkmadan doğrudan KoUp içinde okuma ve yorumlama.
- **Hibrit Otomasyon (Cloudflare Edge Cron + GitHub Actions Cron):**
  - Cloudflare Worker (`koup-edge-worker`, her 30 dakikada bir) ve GitHub Actions (`.github/workflows/koup-scraper.yml`, her 4 saatte bir + 24 saatlik Watchdog doğrulaması).

## 🚀 Kurulum & Çalıştırma

```bash
cd koup-app
npm install
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.
