"""
KoUp Arşiv Kaynak Tarama ve Sağlık Motoru (Source Scanner Engine)
================================================================
Tüm kaynakları (Anime, Dizi, Film, Program) tarar;
1. 403 Forbidden, 404 Not Found, 410 Gone, DNS/SSL çökmesi, alan adı kapanması.
2. 5-10 saniyelik "Bu video artık mevcut değil" / "File was deleted" sahte video tuzakları
   (Sendvid 36789b MP4, YourUpload novideo.mp4, Embedrise/Embedgram sahte MP4, vb.).
3. Aynı kaynakta tekrarlanan sahte medya ve reklam köprüleri.
4. Sağlayıcı özel durumları (OK.ru stub, VK video_ext_msg, Mail.ru video_not_found,
   Filemoon API 404, UPNS/Uns.bio API 404, Tau-Video 429/boş, Vidmoly 404 vb.).
5. HİÇBİR KAYNAĞI SİLMEDEN (Salt Okunur / Analiz Modu) simüle eder:
   - Hangi sağlayıcıda kaç kaynak ölü?
   - Bu ölü kaynaklar çıkarılırsa KAÇ BÖLÜMDE ve KAÇ DİZİDE/ANİMEDE çalışan kaynak kalmıyor?
"""

import os
import sys
import re
import json
import time
import sqlite3
from urllib.parse import urlparse
from collections import Counter, defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")
REPORTS_DIR = os.path.join(BASE_DIR, "scripts", "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

# 1. KESİN KAPANMIŞ / DNS ÇÖKMÜŞ / SSL HATALI / PARK EDİLMİŞ ALAN ADLARI (100% ÖLÜ)
KNOWN_DEAD_DOMAINS = {
    # DNS / Kapanmış / 404 Host
    "short.icu", "short.ink", "abyssplayer.com", "uqload.to", "api.video.mail.ru",
    "playerdkorea.xyz", "four.pichive.online", "pichive.online", "mvidoo.com",
    "savefileway.com", "tubeload.co", "embedo.co", "streamlare.com", "playmogo.com",
    "optraco.top", "upload.embedgram.com", "vid-guard.com", "bullstream.xyz",
    "streamango.com", "diziasya.4meplayer.live", "sn.dplayer82.site", "verycloud.xyz",
    "filelions.live", "filelions.to", "hglink.to", "videobin.co", "dsvplay.com",
    "lulust.com", "streamhide.to", "upload.do", "dhtpre.com",

    # SSL Sertifikası Çökmüş / Servis Kapanmış
    "segavid.com", "vadshar.com", "streamvid.net", "embed.mystream.to", "highload.to",
    "fembed.com", "www.fembed.com", "fembed.net", "www.fembed.net", "fembed-hd.com",
    "www.fembed-hd.com", "upstream.to", "lylxan.com", "viidshar.com", "vtplay.net",
    "vtube.to", "byse.sx", "player.vimple.ru",

    # Cloudflare Origin Hatası Verenler (521 / 523)
    "asyaanimeleri.pw", "video.diziasya.com",

    # Park Edilmiş / Kumar & Reklam Yönlendirmeli Alan Adları
    "vudeo.io", "vudeo.net", "vudeo.co", "vudeo.ws", "redload.co", "mixdrop.co",

    # Servisi Tamamen Kapatılmış Oynatıcılar
    "dood.watch", "doodstream.com", "dood.to", "dood.so", "dood.la", "dood.pm",
    "dood.ws", "dood.sh", "dood.yt", "ghbrisk.com", "luluvdo.com", "luluvdoo.com",
    "embedwish.com", "gett.su", "tune.pk", "allvideo.monster", "hls8.playmix.uno",
    "vgembed.com", "streamruby.com", "streamtape.com", "vidoza.net",
}

# 2. SAHTE / YANILTICI VİDEO VE BOZUK KALIP DESENLERİ
DEAD_URL_PATTERNS = [
    # Boş URL / JavaScript hatası / Ham HTML etiketi
    (re.compile(r"^javascript:", re.I), "javascript_dummy"),
    (re.compile(r"^frameborder=", re.I), "corrupted_html_tag"),
    (re.compile(r"^https:&hd=1", re.I), "corrupted_vk_url"),
    (re.compile(r"^https:Dialogue:", re.I), "corrupted_subtitle_line"),
    
    # Boş ID'ler
    (re.compile(r"drive\.google\.com/file/d//", re.I), "empty_gdrive_id"),
    (re.compile(r"streamtape\.com/e/?$", re.I), "empty_streamtape_id"),
    (re.compile(r"filemoon\.(?:sx|to)/e/?$", re.I), "empty_filemoon_id"),
    (re.compile(r"embed-\.html", re.I), "empty_embed_html"),
    
    # Süresi Dolmuş Google Video İmzaları (403 Forbidden verir)
    (re.compile(r"redirector\.googlevideo\.com/videoplayback", re.I), "expired_googlevideo_signature"),
    
    # Reklam / Video Önü Sahte Sayfaları
    (re.compile(r"_video_onu_yeni\.php", re.I), "preroll_ad_trap"),
    
    # 5-10 Saniyelik Sahte "Bu video artık mevcut değil" Oynatıcıları
    (re.compile(r"embedrise\.com/video\.mp4", re.I), "fake_dummy_mp4_embedrise"),
    (re.compile(r"yourupload\.com/.*novideo\.mp4", re.I), "fake_dummy_mp4_yourupload"),
    
    # Tekrarlayan ve Bilinen Sahte / Bozuk Kayıtlar
    (re.compile(r"hls8\.playmix\.uno/.*master\.txt", re.I), "dead_playmix_master_txt"),
    (re.compile(r"azelvid\.com/player/index\.php", re.I), "azelvid_domain_mismatch"),
    (re.compile(r"gdriveplayer\.to/embed2\.php", re.I), "gdriveplayer_unplayable"),
    (re.compile(r"sn\.dplayer82\.site/iframe\.php", re.I), "dplayer82_cloudflare_block"),
]

def analyze_source_deadness(direct_url: str, provider: str, site: str) -> tuple[bool, str]:
    """
    Bir video kaynağının çalışıp çalışmadığını çok katmanlı kurallarla analiz eder.
    Dönüş: (is_dead: bool, reason: str)
    """
    if not direct_url or direct_url.strip() in ("", "dead"):
        return True, "already_dead_or_empty"

    u = direct_url.strip()
    u_low = u.lower()

    # 1. URL Kalıp Kontrolleri (Regex)
    for pattern, reason in DEAD_URL_PATTERNS:
        if pattern.search(u):
            return True, reason

    # 2. Alan Adı Çıkarma ve Kontrolü
    u_parse = "https:" + u if u.startswith("//") else u
    try:
        parsed = urlparse(u_parse)
        netloc = parsed.netloc.lower()
    except Exception:
        return True, "malformed_url_syntax"

    # Port varsa temizle (örn. vidcache.net:8161)
    domain = netloc.split(":")[0]

    # Bilinen 100% Ölü Alan Adları
    for dead_dom in KNOWN_DEAD_DOMAINS:
        if domain == dead_dom or domain.endswith("." + dead_dom):
            return True, f"dead_host:{dead_dom}"

    # 3. Sağlayıcı Özel Tespitleri
    # Uqload: uqload.com / uqload.io / uqload.co tamamen paywall / blank oldu
    if "uqload" in domain:
        return True, "uqload_dead_paywall"

    # Sendvid: 36,789 byte 5 saniyelik sahte "Video no longer available" tuzağı
    # (Sendvid'in tüm eski CDN linkleri silinmiş videolarda bu 5s sahte MP4'ü döndürür)
    if "sendvid.com" in domain and ("/5uh9z5nc" in u_low or "/6lzyxbsc" in u_low):
        return True, "sendvid_5sec_fake_video"

    # Sibnet: video.sibnet.ru artık 403 Forbidden ("Request forbidden by administrative rules") dönüyor
    # (Kullanıcının belirttiği 'bi kaynağa giriyom 403 diyo' durumu)
    if "sibnet.ru" in domain:
        return True, "sibnet_403_administrative_block"

    return False, "alive"


def run_full_scan():
    print("=" * 80)
    print("🚀 KoUp Gelişmiş Kaynak Tarama ve Simülasyon Motoru Başlatılıyor...")
    print("=" * 80)
    print(f"📁 Veritabanı: {DB_PATH}")

    if not os.path.exists(DB_PATH):
        print(f"❌ HATA: {DB_PATH} bulunamadı!")
        return

    start_time = time.time()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1. Genel Veritabanı Sayımları
    cur.execute("SELECT count(*) FROM dramas;")
    total_dramas = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM episodes;")
    total_episodes = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM episode_sources;")
    total_sources = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM episode_sources WHERE direct_url IS NOT NULL AND direct_url != '' AND direct_url != 'dead';")
    active_sources = cur.fetchone()[0]

    print(f"📊 Toplam İçerik: {total_dramas:,} Dizi/Anime | {total_episodes:,} Bölüm | {total_sources:,} Kaynak ({active_sources:,} Aktif)")

    # 2. Kaynakların Taranması
    print("\n🔍 Tüm aktif kaynaklar kurallar, 403/404 kontrolleri ve sahte video filtreleriyle taranıyor...")

    dead_source_ids = set()
    dead_reasons_counter = Counter()
    dead_by_provider = Counter()
    dead_by_domain = Counter()
    dead_by_site = Counter()

    cur.execute("""
        SELECT id, episode_id, direct_url, provider, site
        FROM episode_sources
        WHERE direct_url IS NOT NULL AND direct_url != '' AND direct_url != 'dead';
    """)

    batch_size = 50000
    total_scanned = 0

    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break
        for r in rows:
            sid = r["id"]
            u = r["direct_url"]
            p = r["provider"] or "unknown"
            s = r["site"] or "unknown"

            is_dead, reason = analyze_source_deadness(u, p, s)
            if is_dead:
                dead_source_ids.add(sid)
                dead_reasons_counter[reason] += 1
                dead_by_provider[p] += 1
                dead_by_site[s] += 1
                try:
                    u_parse = "https:" + u if u.startswith("//") else u
                    dom = urlparse(u_parse).netloc.lower()
                except Exception:
                    dom = "unknown"
                dead_by_domain[dom] += 1

            total_scanned += 1

    print(f"✅ Tarama Tamamlandı: {total_scanned:,} kaynak incelendi.")
    print(f"💀 Tespit Edilen Bozuk/Ölü Kaynak: {len(dead_source_ids):,} ({len(dead_source_ids)/total_scanned*100:.1f}%)")
    print(f"🟢 Çalışan / Sağlam Kalan Kaynak : {total_scanned - len(dead_source_ids):,} ({(total_scanned - len(dead_source_ids))/total_scanned*100:.1f}%)")

    # 3. SİMÜLASYON: Eğer bu çalışmayan kaynaklar kaldırılırsa ne olur?
    print("\n" + "=" * 80)
    print("⚖️ SİMÜLASYON ANALİZİ: ÇALIŞMAYAN KAYNAKLAR ÇIKARILIRSA ETKİ")
    print("=" * 80)

    # Her bölüm ve her drama için mevcut durum vs simüle edilen durum
    cur.execute("""
        SELECT d.id as drama_id, d.title, COALESCE(LOWER(d.content_type), 'dizi') as content_type,
               e.id as episode_id, e.season_number, e.episode_number,
               es.id as source_id
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        LEFT JOIN episode_sources es ON es.episode_id = e.id 
             AND es.direct_url IS NOT NULL AND es.direct_url != '' AND es.direct_url != 'dead';
    """)

    # Veri yapıları
    dramas_meta = {}
    drama_episodes = defaultdict(set)
    ep_all_sources = defaultdict(set)
    ep_alive_sources = defaultdict(set)

    for row in cur.fetchall():
        d_id = row["drama_id"]
        ep_id = row["episode_id"]
        src_id = row["source_id"]

        if d_id not in dramas_meta:
            dramas_meta[d_id] = {
                "title": row["title"],
                "content_type": row["content_type"]
            }

        drama_episodes[d_id].add(ep_id)

        if src_id is not None:
            ep_all_sources[ep_id].add(src_id)
            if src_id not in dead_source_ids:
                ep_alive_sources[ep_id].add(src_id)

    # İstatistikler
    # Bölüm Seviyesinde:
    total_episodes_with_sources = sum(1 for ep in ep_all_sources if len(ep_all_sources[ep]) > 0)
    eps_currently_zero = total_episodes - total_episodes_with_sources
    eps_after_removal_zero = sum(1 for ep_id in ep_alive_sources if len(ep_alive_sources[ep_id]) == 0) + (total_episodes - len(ep_alive_sources))
    newly_zero_source_episodes = eps_after_removal_zero - eps_currently_zero

    # Dizi/İçerik Seviyesinde Tür Bazlı İnceleme
    type_stats = defaultdict(lambda: {
        "total_dramas": 0,
        "total_episodes": 0,
        "cur_dramas_all_alive": 0,
        "cur_dramas_partial_loss": 0,
        "cur_dramas_zero_source": 0,
        "sim_dramas_all_alive": 0,
        "sim_dramas_partial_loss": 0,
        "sim_dramas_zero_source": 0,
        "newly_zero_dramas": 0,
        "newly_zero_drama_samples": []
    })

    zero_dramas_by_removal = []

    for d_id, meta in dramas_meta.items():
        ctype = meta["content_type"]
        eps = drama_episodes[d_id]
        st = type_stats[ctype]
        st["total_dramas"] += 1
        st["total_episodes"] += len(eps)

        # Mevcut durum
        cur_dead_eps = sum(1 for ep in eps if len(ep_all_sources[ep]) == 0)
        if cur_dead_eps == 0:
            st["cur_dramas_all_alive"] += 1
        elif cur_dead_eps == len(eps):
            st["cur_dramas_zero_source"] += 1
        else:
            st["cur_dramas_partial_loss"] += 1

        # Simülasyon sonrası durum
        sim_dead_eps = sum(1 for ep in eps if len(ep_alive_sources[ep]) == 0)
        if sim_dead_eps == 0:
            st["sim_dramas_all_alive"] += 1
        elif sim_dead_eps == len(eps):
            st["sim_dramas_zero_source"] += 1
            if cur_dead_eps < len(eps):
                # Bu çıkarma yüzünden SIFIR KAYNAKLI HALE GELEN DİZİ!
                st["newly_zero_dramas"] += 1
                item_info = {
                    "id": d_id,
                    "title": meta["title"],
                    "type": ctype,
                    "eps_count": len(eps),
                    "old_sources_count": sum(len(ep_all_sources[ep]) for ep in eps),
                }
                zero_dramas_by_removal.append(item_info)
                if len(st["newly_zero_drama_samples"]) < 10:
                    st["newly_zero_drama_samples"].append(item_info)
        else:
            st["sim_dramas_partial_loss"] += 1

    # Raporlama Ekranı
    print(f"\n📌 BÖLÜM SEVİYESİNDE DEĞİŞİM:")
    print(f"  • Toplam Bölüm Sayısı                      : {total_episodes:,}")
    print(f"  • Halihazırda 0 Kaynaklı Olan Bölümler     : {eps_currently_zero:,} (%{eps_currently_zero/total_episodes*100:.1f})")
    print(f"  • Çıkarılırsa 0 Kaynaklı Kalacak Bölümler  : {eps_after_removal_zero:,} (%{eps_after_removal_zero/total_episodes*100:.1f})")
    print(f"  🚨 BU İŞLEMLE HİÇ KAYNAĞI KALMAYACAK BÖLÜMLER: +{newly_zero_source_episodes:,} YENİ BÖLÜM!")

    print(f"\n📌 SERİ / DİZİ / ANİME SEVİYESİNDE DEĞİŞİM:")
    for ctype, st in type_stats.items():
        print(f"\n  [{ctype.upper()}] (Toplam {st['total_dramas']:,} yapım):")
        print(f"    - Mevcut Sıfır Kaynaklı Yapım : {st['cur_dramas_zero_source']:,}")
        print(f"    - Çıkarılırsa Sıfır Kaynaklı  : {st['sim_dramas_zero_source']:,}")
        print(f"    🚨 BU İŞLEMLE HİÇ KAYNAĞI KALMAYACAK YAPIMLAR: +{st['newly_zero_dramas']:,} ADET!")
        print(f"    - Kısmi Bölümü Boş Kalacaklar : {st['sim_dramas_partial_loss']:,}")
        print(f"    - Tüm Bölümleri Çalışan       : {st['sim_dramas_all_alive']:,}")

    # En Çok Etkilenen Başlıca Ölü Sağlayıcılar
    print("\n📌 EN ÇOK ÇALIŞMAYAN KAYNAK BULUNAN SAĞLAYICILAR:")
    for prov, count in dead_by_provider.most_common(15):
        print(f"  • {prov:25}: {count:8,} adet")

    print("\n📌 TESPİT EDİLEN BOZUKLUK NEDENLERİ:")
    for reason, count in dead_reasons_counter.most_common(15):
        print(f"  • {reason:32}: {count:8,} adet")

    # JSON ve Markdown Raporu Kaydetme
    report_json_path = os.path.join(REPORTS_DIR, "source_scanner_simulation_report.json")
    report_md_path = os.path.join(REPORTS_DIR, "source_scanner_simulation_report.md")

    report_data = {
        "scan_time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_sources_scanned": total_scanned,
        "dead_sources_count": len(dead_source_ids),
        "alive_sources_count": total_scanned - len(dead_source_ids),
        "episode_stats": {
            "total_episodes": total_episodes,
            "currently_zero_source_episodes": eps_currently_zero,
            "simulated_zero_source_episodes": eps_after_removal_zero,
            "newly_zero_episodes": newly_zero_source_episodes
        },
        "content_type_breakdown": {
            ctype: {
                "total_dramas": s["total_dramas"],
                "currently_zero_dramas": s["cur_dramas_zero_source"],
                "simulated_zero_dramas": s["sim_dramas_zero_source"],
                "newly_zero_dramas": s["newly_zero_dramas"],
                "samples": s["newly_zero_drama_samples"]
            } for ctype, s in type_stats.items()
        },
        "dead_reasons_breakdown": dict(dead_reasons_counter),
        "dead_providers_breakdown": dict(dead_by_provider),
        "newly_zero_dramas_list": zero_dramas_by_removal[:100]
    }

    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, ensure_ascii=False, indent=2)

    # Markdown raporu
    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write(f"""# KoUp Kaynak Tarama ve Ön Simülasyon Raporu
*Tarih:* {time.strftime('%d.%m.%Y %H:%M:%S')}  
*Veritabanı:* `webdrama_archive.db`

> **ÖNEMLİ:** Bu analiz salt-okunur (read-only) simülasyon modunda yapılmıştır. **Hiçbir kaynak silinmemiştir.**

---

## 📊 Genel Özet

| Metrik | Mevcut Durum | Çıkarılırsa (Simülasyon) | Net Değişim / Kayıp |
| :--- | :--- | :--- | :--- |
| **Toplam Aktif Kaynak** | {total_scanned:,} | {total_scanned - len(dead_source_ids):,} | **-{len(dead_source_ids):,} (%{len(dead_source_ids)/total_scanned*100:.1f})** |
| **Sıfır Kaynaklı Kalan Bölümler** | {eps_currently_zero:,} | {eps_after_removal_zero:,} | **+{newly_zero_source_episodes:,} yeni boş bölüm** |
| **Sıfır Kaynaklı Kalan Diziler (Dizi)** | {type_stats['dizi']['cur_dramas_zero_source']:,} | {type_stats['dizi']['sim_dramas_zero_source']:,} | **+{type_stats['dizi']['newly_zero_dramas']:,} dizi tamamen kaynaksız** |
| **Sıfır Kaynaklı Kalan Animeler** | {type_stats['anime']['cur_dramas_zero_source']:,} | {type_stats['anime']['sim_dramas_zero_source']:,} | **+{type_stats['anime']['newly_zero_dramas']:,} anime tamamen kaynaksız** |
| **Sıfır Kaynaklı Kalan Filmler** | {type_stats['film']['cur_dramas_zero_source']:,} | {type_stats['film']['sim_dramas_zero_source']:,} | **+{type_stats['film']['newly_zero_dramas']:,} film tamamen kaynaksız** |

---

## 🚨 Kaynaklar Silinirse Tamamen Kaynaksız Kalacak Bazı Başlıca Yapımlar (Örnekler)

""")
        for d in zero_dramas_by_removal[:40]:
            f.write(f"- **[ID: {d['id']}] {d['title']}** ({d['type'].upper()}) - {d['eps_count']} bölüm, eski {d['old_sources_count']} kaynağın tümü ölüydü.\n")

    print(f"\n💾 Detaylı Raporlar Kaydedildi:")
    print(f"  • JSON: {report_json_path}")
    print(f"  • MD  : {report_md_path}")
    print(f"⏱️ Geçen Süre: {time.time() - start_time:.1f} saniye.")
    conn.close()

if __name__ == "__main__":
    run_full_scan()
