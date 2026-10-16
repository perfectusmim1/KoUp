"""
KoUp Video Source Auditor (Stream Health & Dead Source Detection)
================================================================
webdrama_archive.db (episode_sources tablosu - ~1.6M satır) üzerinde:
1. Ölü ve bozuk kaynakları (404, 403, DNS hatası, silinmiş video, telif engeli, sahte placeholder) tespit eder.
2. Düzeltilebilir URL desenlerini (vidmoly.to -> vidmoly.biz, bozuk https:https önekleri, href.li ve luffytra2 proxy açımları, protocol-relative // linkleri) onarır.
3. Ölü sağlayıcıların elenmesi sonrası SIFIR KAYNAKLI (Zero-Source) kalan dizileri/animeleri listeler.
4. SQLite veritabanında direct_url = 'dead' güncellemesi yapar ve JSON/Markdown formatında rapor üretir.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

try:
    from curl_cffi import requests as cfr
    HAVE_CURL_CFFI = True
except ImportError:
    import urllib.request
    HAVE_CURL_CFFI = False

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")
REPORTS_DIR = os.path.join(BASE_DIR, "scripts", "reports")

# 100% Kapanmış, DNS Çözülemeyen veya Servis Dışı Kalmış Kesin Ölü Domain Listesi
DEAD_DOMAINS = [
    "short.icu",
    "short.ink",
    "abyssplayer.com",
    "uqload.to",
    "api.video.mail.ru",
    "playerdkorea.xyz",
    "four.pichive.online",
    "pichive.online",
    "mvidoo.com",
    "savefileway.com",
    "tubeload.co",
    "embedo.co",
    "streamlare.com",
    "vudeo.io",
    "vudeo.net",
    "dood.watch",
    "doodstream.com",
    "dood.to",
    "dood.so",
    "dood.la",
    "dood.pm",
    "dood.ws",
    "playmogo.com",
    "optraco.top"
]

# Sahte Placeholder / Silinmiş Video HTML İçerik Göstergeleri
DEAD_TEXT_PATTERNS = [
    "file is no longer available as it expired or has been deleted",
    "the file you were looking for could not be found",
    "file was deleted",
    "file not found",
    "video not found",
    "video has been deleted",
    "video has been blocked",
    "видеозапись удалена",
    "видео не найдено",
    "böyle bir video yok",
    "video bulunamadı",
    "video kaldırıldı",
    "kaldırılmış",
    "istenen dosya mevcut değil",
    "sayfa bulunamadı",
    "request forbidden by administrative rules",
    "copyright infringement",
    "telif hakkı nedeniyle kaldırıldı"
]

DEAD_TITLES = [
    "video not found | doodstream",
    "sayfa bulunamadı",
    "404 not found",
    "404 - not found",
    "attention required! | cloudflare",
    "file not found"
]

def clean_and_repair_url(url: str) -> tuple[str, str | None]:
    """
    Bozuk URL desenlerini onarır.
    Dönüş: (onarılan_url, uygulanan_düzeltme_adı veya None)
    """
    if not url:
        return "", None

    fixed = url.strip()
    reason = None

    # 1. Ham <iframe> etiketi içinden URL çıkarma
    if "<iframe" in fixed.lower() or "&lt;iframe" in fixed.lower():
        m = re.search(r'src=["\']([^"\']+)["\']', fixed)
        if m:
            fixed = m.group(1).strip()
            reason = "iframe_extracted"

    # 2. Çok satırlı (multiline) yapıştırma hataları - ilk geçerli URL'yi seç
    if "\n" in fixed or "\r" in fixed:
        lines = [line.strip() for line in re.split(r"[\r\n]+", fixed) if line.strip()]
        # Öncelikle ok.ru, vidmoly veya bilinen çalışan URL ara
        chosen = lines[0]
        for l in lines:
            if "ok.ru" in l or "odnoklassniki" in l or "vidmoly.biz" in l:
                chosen = l
                break
        fixed = chosen
        reason = "multiline_first_line_selected"

    # 3. https:https://href.li/? ve benzeri çifte önekleri temizle
    if "href.li/?" in fixed:
        fixed = fixed.split("href.li/?")[-1].strip()
        reason = "href_li_unwrapped"

    # 4. luffytra2 proxy sarmalayıcısını temizle
    if "luffytra2.top/embed2/?id=" in fixed:
        fixed = fixed.split("luffytra2.top/embed2/?id=")[-1].strip()
        reason = "luffytra_unwrapped"

    # 5. Bozuk şema/protokol temizliği
    if fixed.startswith("https:https://"):
        fixed = "https://" + fixed[14:]
        reason = reason or "double_https_fixed"
    elif fixed.startswith("https:://"):
        fixed = "https://" + fixed[9:]
        reason = reason or "corrupted_scheme_fixed"
    elif fixed.startswith("https:/") and not fixed.startswith("https://"):
        fixed = "https://" + fixed[7:]
        reason = reason or "single_slash_scheme_fixed"
    elif fixed.startswith("http:/") and not fixed.startswith("http://"):
        fixed = "http://" + fixed[6:]
        reason = reason or "single_slash_http_fixed"
    elif fixed.startswith("//"):
        fixed = "https:" + fixed
        reason = reason or "protocol_relative_fixed"

    # 6. vidmolynet typo
    if "vidmolynet" in fixed:
        fixed = fixed.replace("vidmolynet", "vidmoly.net")
        reason = reason or "vidmolynet_typo_fixed"

    # 7. vidmoly.to -> vidmoly.biz (vidmoly.to artık bozuk yükleme sayfası verir, biz çalışır)
    if "vidmoly.to/" in fixed:
        fixed = fixed.replace("vidmoly.to/", "vidmoly.biz/")
        reason = reason or "vidmoly_to_to_biz"

    return fixed, reason


def is_definitely_dead_rule(url: str) -> tuple[bool, str]:
    """
    Kural tabanlı (hızlı/ağ gerektirmeyen) %100 kesin ölü tespiti.
    """
    if not url or url == "dead":
        return True, "already_marked_dead"

    u_low = url.lower()

    # Boş dosya kimlikleri
    if "/file/d//preview" in u_low or "/file/d//view" in u_low:
        return True, "empty_gdrive_id"
    if "embed-.html" in u_low:
        return True, "empty_embed_html"
    if "videoid=&" in u_low or "videoid=0&" in u_low or u_low.endswith("videoid="):
        return True, "empty_videoid"

    # Kesin ölü domainler
    for d in DEAD_DOMAINS:
        if d in u_low:
            return True, f"dead_domain:{d}"

    return False, ""


def check_url_network(url: str, session=None, timeout: float = 8.0) -> dict:
    """
    URL'yi canlı ağ testiyle kontrol eder, HTTP kodunu ve video içeriğini doğrular.
    """
    clean_url, _ = clean_and_repair_url(url)
    is_dead, reason = is_definitely_dead_rule(clean_url)
    if is_dead:
        return {"url": clean_url, "alive": False, "status": 0, "reason": reason}

    if session is None and HAVE_CURL_CFFI:
        session = cfr.Session(impersonate="chrome")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
    }
    if "sibnet.ru" in clean_url:
        headers["Referer"] = "https://video.sibnet.ru/"
    elif "vk.com" in clean_url:
        headers["Referer"] = "https://vk.com/"

    try:
        if HAVE_CURL_CFFI:
            resp = session.get(clean_url, headers=headers, timeout=timeout, allow_redirects=True)
            status_code = resp.status_code
            text = resp.text
            final_url = resp.url
        else:
            req = urllib.request.Request(clean_url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status_code = response.getcode()
                text = response.read().decode("utf-8", errors="ignore")
                final_url = response.geturl()

        # HTTP Hata kodları
        if status_code in (404, 410):
            return {"url": clean_url, "alive": False, "status": status_code, "reason": f"http_{status_code}"}
        if status_code in (403, 523, 502, 503):
            return {"url": clean_url, "alive": False, "status": status_code, "reason": f"http_{status_code}_blocked"}

        # İçerik Kontrolleri (Sahte placeholder / Silinmiş video)
        low_text = text.lower()
        title_m = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
        title = title_m.group(1).strip().lower() if title_m else ""

        for bad_title in DEAD_TITLES:
            if bad_title in title:
                return {"url": clean_url, "alive": False, "status": status_code, "reason": f"dead_title:{bad_title}"}

        for p in DEAD_TEXT_PATTERNS:
            if p in low_text:
                return {"url": clean_url, "alive": False, "status": status_code, "reason": f"placeholder_text:{p}"}

        # Uqload özel 794 byte placeholder kontrolü
        if "uqload" in clean_url and len(text) < 1200 and "player_blank.jpg" in text:
            return {"url": clean_url, "alive": False, "status": status_code, "reason": "uqload_blank_placeholder"}

        return {"url": clean_url, "alive": True, "status": status_code, "final_url": final_url, "reason": "ok"}

    except Exception as e:
        err_msg = type(e).__name__
        return {"url": clean_url, "alive": False, "status": 0, "reason": f"network_error:{err_msg}"}


def run_source_audit(
    sample_size: int | None = None,
    apply_db: bool = False,
    fix_urls: bool = False,
    test_network: bool = False,
    workers: int = 8,
    output_json: str | None = None,
    output_md: str | None = None,
):
    start_time = time.time()
    os.makedirs(REPORTS_DIR, exist_ok=True)
    if not output_json:
        output_json = os.path.join(REPORTS_DIR, "source_audit_report.json")
    if not output_md:
        output_md = os.path.join(REPORTS_DIR, "source_audit_report.md")

    print(f"🚀 KoUp Kaynak Denetçisi (Source Auditor) Başlatılıyor...")
    print(f"📁 Veritabanı: {DB_PATH}")
    print(f"⚙️ Parametreler: sample={sample_size}, apply_db={apply_db}, fix_urls={fix_urls}, test_network={test_network}")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    cur = conn.cursor()

    cur.execute("SELECT count(*) FROM episode_sources;")
    total_sources = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM dramas;")
    total_dramas = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM episodes;")
    total_episodes = cur.fetchone()[0]

    print(f"📊 Mevcut Durum: {total_dramas:,} dizi, {total_episodes:,} bölüm, {total_sources:,} kaynak.")

    # 1. Adım: Düzeltilebilir URL Taraması
    print("\n🔍 [1/4] Düzeltilebilir ve Format Hatası Olan URL'ler Taranıyor...")
    fix_candidates = []
    repair_counter = Counter()

    # Bellek tasarruflu imleç okuması
    cur.execute("SELECT id, direct_url FROM episode_sources;")
    batch_size = 50000
    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break
        for src_id, raw_url in rows:
            if not raw_url or raw_url == "dead":
                continue
            repaired_url, reason = clean_and_repair_url(raw_url)
            if reason is not None and repaired_url != raw_url:
                fix_candidates.append((src_id, raw_url, repaired_url, reason))
                repair_counter[reason] += 1

    print(f"  ✅ Toplam {len(fix_candidates):,} onarılabilir URL tespit edildi:")
    for r_type, count in repair_counter.most_common():
        print(f"     - {r_type:35}: {count:,}")

    # URL Düzeltmelerini Veritabanına Yaz (Fix-URLs açık ise)
    if fix_urls and fix_candidates:
        print(f"\n🛠️ [1.1] {len(fix_candidates):,} URL veritabanında onarılıyor...")
        update_data = [(rep_url, s_id) for s_id, _, rep_url, _ in fix_candidates]
        cur.executemany("UPDATE episode_sources SET direct_url = ? WHERE id = ?;", update_data)
        conn.commit()
        print("  🎉 URL onarımları başarıyla veritabanına uygulandı!")

    # 2. Adım: Kesin Ölü Kaynak Taraması (Kural Tabanlı)
    print("\n💀 [2/4] Kural Tabanlı Kesin Ölü Kaynaklar Taranıyor...")
    dead_candidates = []
    dead_provider_counts = Counter()

    cur.execute("SELECT id, direct_url, provider FROM episode_sources;")
    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break
        for src_id, url, prov in rows:
            is_dead, reason = is_definitely_dead_rule(url)
            if is_dead and url != "dead":
                dead_candidates.append((src_id, reason))
                dead_provider_counts[reason] += 1

    print(f"  ⚠️ Toplam {len(dead_candidates):,} kaynak %100 KESİN ÖLÜ olarak tespit edildi:")
    for d_reason, cnt in dead_provider_counts.most_common(20):
        print(f"     - {d_reason:35}: {cnt:,}")

    # Canlı Ağ Testi (Opsiyonel / Örneklem Üzerinde)
    network_tested_results = []
    if test_network:
        sample_limit = sample_size or 500
        print(f"\n🌐 [2.1] {sample_limit} adet kaynak üzerinde canlı HTTP ve placeholder testi yapılıyor...")
        cur.execute("""
            SELECT id, direct_url, provider 
            FROM episode_sources 
            WHERE direct_url != 'dead' AND direct_url IS NOT NULL 
            ORDER BY RANDOM() LIMIT ?;
        """, (sample_limit,))
        test_rows = cur.fetchall()

        session = cfr.Session(impersonate="chrome") if HAVE_CURL_CFFI else None

        def worker_task(item):
            s_id, u, prov = item
            res = check_url_network(u, session=session)
            res["id"] = s_id
            res["provider"] = prov
            return res

        with ThreadPoolExecutor(max_workers=workers) as ex:
            network_tested_results = list(ex.map(worker_task, test_rows))

        alive_cnt = sum(1 for r in network_tested_results if r["alive"])
        dead_net_cnt = sum(1 for r in network_tested_results if not r["alive"])
        print(f"  📊 Test Sonucu: {alive_cnt} Canlı ({alive_cnt/len(test_rows)*100:.1f}%), {dead_net_cnt} Ölü/Kaldırılmış ({dead_net_cnt/len(test_rows)*100:.1f}%)")

    # Veritabanında Ölü Olarak İşaretle (Apply-DB açık ise)
    if apply_db and dead_candidates:
        print(f"\n💾 [2.2] {len(dead_candidates):,} ölü kaynak veritabanında 'dead' olarak güncelleniyor...")
        dead_ids = [(c[0],) for c in dead_candidates]
        cur.executemany("UPDATE episode_sources SET direct_url = 'dead', provider = 'dead' WHERE id = ?;", dead_ids)
        conn.commit()
        print("  🎉 Ölü kaynaklar veritabanına işlendi!")

    # 3. Adım: Sıfır Kaynaklı (Zero-Source) Kalan Dizilerin Tespiti
    print("\n🔍 [3/4] Ölü Kaynaklar Sonrası SIFIR KAYNAKLI Kalan Diziler Taranıyor...")
    cur.execute("""
        SELECT d.id, d.title, d.country, d.release_year, d.content_type, e.id as ep_id, s.id as src_id, s.direct_url
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        LEFT JOIN episode_sources s ON s.episode_id = e.id;
    """)

    drama_info = {}
    drama_episodes = defaultdict(set)
    ep_live_sources = defaultdict(int)
    drama_total_sources = defaultdict(int)
    drama_live_sources = defaultdict(int)

    for d_id, title, country, year, ctype, ep_id, src_id, d_url in cur.fetchall():
        if d_id not in drama_info:
            drama_info[d_id] = {
                "id": d_id,
                "title": title or f"Dizi #{d_id}",
                "country": country or "??",
                "year": year or "????",
                "type": ctype or "dizi",
            }
        drama_episodes[d_id].add(ep_id)
        if src_id is not None:
            drama_total_sources[d_id] += 1
            # Ölü kontrolü: veritabanı uygulanmadıysa bile simüle edilmiş ölüleri hesaba kat
            is_dead, _ = is_definitely_dead_rule(d_url)
            if not is_dead and d_url != "dead":
                drama_live_sources[d_id] += 1
                ep_live_sources[ep_id] += 1

    zero_source_dramas = []
    partial_dramas = []
    healthy_dramas = []

    for d_id, info in drama_info.items():
        eps = drama_episodes[d_id]
        tot_eps = len(eps)
        tot_src = drama_total_sources[d_id]
        live_src = drama_live_sources[d_id]
        missing_eps = sum(1 for ep in eps if ep_live_sources[ep] == 0)

        item_data = {
            "id": d_id,
            "title": info["title"],
            "country": info["country"],
            "year": info["year"],
            "type": info["type"],
            "total_episodes": tot_eps,
            "total_sources_before": tot_src,
            "live_sources": live_src,
            "missing_episodes": missing_eps,
        }

        if live_src == 0:
            zero_source_dramas.append(item_data)
        elif missing_eps > 0:
            partial_dramas.append(item_data)
        else:
            healthy_dramas.append(item_data)

    # Sıfır bölümlü (hiç bölümü eklenmemiş) dizileri de listeye al
    cur.execute("""
        SELECT d.id, d.title, d.country, d.release_year, d.content_type
        FROM dramas d
        LEFT JOIN episodes e ON e.drama_id = d.id
        WHERE e.id IS NULL;
    """)
    for d_id, title, country, year, ctype in cur.fetchall():
        zero_source_dramas.append({
            "id": d_id,
            "title": title or f"Dizi #{d_id}",
            "country": country or "??",
            "year": year or "????",
            "type": ctype or "dizi",
            "total_episodes": 0,
            "total_sources_before": 0,
            "live_sources": 0,
            "missing_episodes": 0,
        })

    print(f"\n📊 Dizi Durum Özeti:")
    print(f"  🚨 SIFIR CANLI KAYNAKLI DİZİLER (Acil Yeniden Taranması Gereken): {len(zero_source_dramas):,}")
    print(f"  ⚠️  Kısmi Kayıp Diziler (Bazı bölümlerinde çalışan kaynak kalmamış): {len(partial_dramas):,}")
    print(f"  ✅ Tamamen Sağlıklı Diziler (Her bölümünde en az 1 çalışan kaynak var): {len(healthy_dramas):,}")

    # 4. Adım: Rapor Üretimi (JSON ve Markdown)
    print("\n📝 [4/4] Raporlar Hazırlanıyor...")

    # JSON Raporu
    report_data = {
        "audit_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_sources_analyzed": total_sources,
        "total_dramas_analyzed": total_dramas,
        "total_episodes_analyzed": total_episodes,
        "dead_sources_count": len(dead_candidates),
        "fixable_urls_count": len(fix_candidates),
        "repair_breakdown": dict(repair_counter),
        "dead_provider_breakdown": dict(dead_provider_counts),
        "summary": {
            "zero_source_dramas_count": len(zero_source_dramas),
            "partial_dramas_count": len(partial_dramas),
            "healthy_dramas_count": len(healthy_dramas),
        },
        "zero_source_dramas": sorted(
            zero_source_dramas,
            key=lambda x: (x["total_episodes"], x["total_sources_before"]),
            reverse=True,
        ),
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(report_data, f, ensure_ascii=False, indent=2)
    print(f"  💾 JSON Raporu kaydedildi: {output_json}")

    # Markdown Raporu
    md_content = f"""# KoUp Video Kaynak ve Sağlayıcı Denetim Raporu
*Oluşturulma Tarihi:* {time.strftime("%d.%m.%Y %H:%M:%S")}  
*Taranan Veritabanı:* `webdrama_archive.db`

---

## 📌 Genel İstatistikler ve Sağlık Özeti

| Metrik | Sayı | Yüzde / Oran |
| :--- | :--- | :--- |
| **Toplam Kaynak Sayısı** | **{total_sources:,}** | 100% |
| **Kesin Ölü Kaynaklar** | **{len(dead_candidates):,}** | **{len(dead_candidates)/total_sources*100:.1f}%** |
| **Düzeltilebilir / Kurtarılabilir URL'ler** | **{len(fix_candidates):,}** | **{len(fix_candidates)/total_sources*100:.1f}%** |
| **Toplam Dizi / İçerik Sayısı** | **{total_dramas:,}** | 100% |
| 🚨 **Sıfır Kaynaklı Kalan İçerikler (Zero-Source)** | **{len(zero_source_dramas):,}** | **{len(zero_source_dramas)/total_dramas*100:.1f}%** |
| ⚠️ **Kısmi Kaynak Kayıplı Diziler** | **{len(partial_dramas):,}** | **{len(partial_dramas)/total_dramas*100:.1f}%** |
| ✅ **Her Bölümünde Çalışan Kaynak Olan Diziler** | **{len(healthy_dramas):,}** | **{len(healthy_dramas)/total_dramas*100:.1f}%** |

---

## 💀 Kapanan ve %100 Ölü Sağlayıcılar Listesi

Aşağıdaki sağlayıcıların alan adları (DNS) kapanmış, SSL sertifikaları düşmüş veya servisleri tamamen kaldırılmıştır:

| Sağlayıcı / Neden | Etkilenen Kaynak | Durum / Sebep |
| :--- | :--- | :--- |
"""
    for d_reason, cnt in dead_provider_counts.most_common(20):
        md_content += f"| `{d_reason}` | {cnt:,} | DNS Çözülemiyor / Servis Kapalı / Kalıcı HTTP Hatası |\n"

    md_content += f"""
---

## 🛠️ Düzeltilebilir URL Desenleri ve Onarım Kuralları

Bu kaynaklar silinmek yerine regex kurallarıyla kurtarılabilmektedir:

| Düzeltme Tipi | Adet | Uygulanan Aksiyon |
| :--- | :--- | :--- |
"""
    for r_type, count in repair_counter.most_common():
        md_content += f"| `{r_type}` | {count:,} | Desen temizlendi / çalışan alternatif domaine yönlendirildi |\n"

    md_content += f"""
---

## 🚨 Sıfır Kaynaklı Kalan ve Yeniden Taranması Gereken Başlıca Diziler (Top 50)

Bu dizilerin sahip olduğu tüm video kaynakları ölü sağlayıcılardan oluştuğu için sistemde oynatılamaz hale gelmiştir. Yeniden scrape edilmesi veya alternatif fansub/kaynaklarla yamalanması önerilir:

| ID | Başlık | Tür | Ülke | Bölüm Sayısı | Eski Kaynak Sayısı |
| :--- | :--- | :--- | :--- | :--- | :--- |
"""
    for d in sorted(
        zero_source_dramas,
        key=lambda x: (x["total_episodes"], x["total_sources_before"]),
        reverse=True,
    )[:50]:
        md_content += f"| {d['id']} | **{d['title']}** | {d['type']} | {d['country']} | {d['total_episodes']} | {d['total_sources_before']} |\n"

    md_content += f"""
---
*Rapor `scripts/source_auditor.py` tarafından otomatik olarak üretilmiştir.*
"""

    with open(output_md, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"  💾 Markdown Raporu kaydedildi: {output_md}")

    elapsed = time.time() - start_time
    print(f"\n✨ Denetim tamamlandı! (Geçen süre: {elapsed:.1f} sn)")

    conn.close()
    return report_data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KoUp Video Kaynak Denetçisi ve Onarıcısı")
    parser.add_argument("--sample", type=int, default=None, help="Canlı test için örneklem büyüklüğü")
    parser.add_argument("--apply-db", action="store_true", help="Ölü kaynakları veritabanında 'dead' olarak güncelle")
    parser.add_argument("--fix-urls", action="store_true", help="Bozuk URL'leri onar ve veritabanına kaydet")
    parser.add_argument("--test-network", action="store_true", help="Canlı HTTP / placeholder tespiti yap")
    parser.add_argument("--workers", type=int, default=8, help="Ağ testi için paralel iş parçacığı sayısı")
    parser.add_argument("--output-json", type=str, default=None, help="Çıktı JSON rapor yolu")
    parser.add_argument("--output-md", type=str, default=None, help="Çıktı Markdown rapor yolu")
    args = parser.parse_args()

    run_source_audit(
        sample_size=args.sample,
        apply_db=args.apply_db,
        fix_urls=args.fix_urls,
        test_network=args.test_network,
        workers=args.workers,
        output_json=args.output_json,
        output_md=args.output_md,
    )
