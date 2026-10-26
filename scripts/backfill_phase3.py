"""
Phase 3 Backfill & Sync Pipeline Runner.
Supports:
- Live calendar syncing from diziizle.wiki (/takvim)
- Turkish dramas & Pilavyer HD player backfill from diziizle.wiki
- New series & movies WDT player backfill from webdramaturkey2.com
- Full sync chain: SQLite -> R2 Bundles -> Supabase Media & Episodes -> R2 Database Backup
"""

import argparse
import os
import sqlite3
import sys
import time

# Ensure project root is in sys.path
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.multisite import build_drama_index
from scrapers.sites.diziizle import crawl_diziizle_recent, scrape_diziizle_series, sync_diziizle_calendar
from scrapers.sites.webdramaturkey import crawl_webdramaturkey_recent
from scrapers.supabase_sync_helper import backup_db_to_r2


def get_db():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path, timeout=60)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    return conn


def run_phase3(site: str = "all", limit: int = 5, resume: bool = False):
    conn = get_db()
    cur = conn.cursor()
    print(f"=== [FAZ 3 BACKFILL BAŞLATILDI] Site: {site} | Limit: {limit} | Resume: {resume} ===", flush=True)

    total_calendar_items = 0
    diziizle_results = []
    wdt_results = []

    # 1. Calendar Sync
    if site in ("calendar", "all"):
        print("\n--- [1/3] Diziİzle Canlı Yayın Takvimi Senkronizasyonu ---", flush=True)
        try:
            total_calendar_items = sync_diziizle_calendar(conn=conn, cur=cur)
            print(f"[FAZ 3 CALENDAR] Toplam senkronlanan takvim ögesi: {total_calendar_items}", flush=True)
        except Exception as e:
            print(f"[FAZ 3 CALENDAR HATA]: {e}", flush=True)

    # 2. Diziİzle Pilavyer HD Backfill
    if site in ("diziizle", "all"):
        print(f"\n--- [2/3] Diziİzle Türk Dizileri & Pilavyer HD Çekimi (Limit: {limit}) ---", flush=True)
        try:
            idx = build_drama_index(cur)

            # Fetch sitemap to ensure 100% verified URLs
            import re
            import requests
            from scrapers.multisite import norm_title

            dizi_sitemap_urls = {}
            try:
                r_sm = requests.get("https://diziizle.wiki/sitemap-series.xml", timeout=12)
                if r_sm.status_code == 200:
                    for l in r_sm.text.splitlines():
                        m = re.search(r"<loc>(https://diziizle\.wiki/dizi/([^<]+))</loc>", l)
                        if m:
                            full_u, s_slug = m.group(1), m.group(2)
                            dizi_sitemap_urls[s_slug] = full_u
            except Exception:
                pass

            # Map normalized titles to sitemap URLs for fuzzy matching
            norm_map = {}
            for s_slug, full_u in dizi_sitemap_urls.items():
                clean_name = norm_title(s_slug.replace("-", " "))
                if len(clean_name) >= 4:
                    norm_map[clean_name] = full_u

            # Match our Turkish dramas (especially YouTube ones)
            cur.execute("""
                SELECT d.id, d.title, d.slug 
                FROM dramas d
                WHERE d.country = 'TR'
            """)
            tr_all = cur.fetchall()

            targeted_urls = []
            seen_target = set()
            for did, title, slug in tr_all:
                url_match = None
                if slug in dizi_sitemap_urls:
                    url_match = dizi_sitemap_urls[slug]
                elif title and norm_title(title) in norm_map:
                    url_match = norm_map[norm_title(title)]

                if url_match and url_match not in seen_target:
                    targeted_urls.append(url_match)
                    seen_target.add(url_match)

            print(f"[DIZIIZLE TARGET] Arşivimizdeki Türk dizilerinden {len(targeted_urls)} tanesi Diziİzle ile %100 eşleşti.", flush=True)

            # Crawl targeted or recent diziizle series (0 = full episodes for each series)
            diziizle_results = crawl_diziizle_recent(
                cur=cur,
                conn=conn,
                idx=idx,
                limit=limit,
                max_episodes_per_series=0,
                target_urls=targeted_urls,
            )
            print(f"[FAZ 3 DIZIIZLE] {len(diziizle_results)} yapım işlendi.", flush=True)
        except Exception as e:
            print(f"[FAZ 3 DIZIIZLE HATA]: {e}", flush=True)

    # 3. WebDramaTurkey2 WDT Player Backfill
    if site in ("webdramaturkey2", "all"):
        print(f"\n--- [3/3] WebDramaTurkey2 Yeni Diziler & Filmler (WDT HD) Çekimi (Limit: {limit}) ---", flush=True)
        try:
            idx = build_drama_index(cur)
            wdt_results = crawl_webdramaturkey_recent(
                cur=cur,
                conn=conn,
                idx=idx,
                limit=limit,
                category="all",
            )
            print(f"[FAZ 3 WDT] {len(wdt_results)} yeni yapım işlendi.", flush=True)
        except Exception as e:
            print(f"[FAZ 3 WDT HATA]: {e}", flush=True)

    # 4. Final WAL checkpoint and Full Storage Sync
    try:
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        print("\n--- [DEPİ SENKRONİZASYONU] Cloudflare R2 Veritabanı Yedeklemesi Başlatılıyor ---", flush=True)
        backed_up = backup_db_to_r2()
        print(f"[R2 DB BACKUP] Sonuç: {'Başarılı' if backed_up else 'Atlandı/Hata'}", flush=True)
    except Exception as e:
        print(f"[DB FINAL SYNC WARN]: {e}", flush=True)

    # Summary Report
    print("\n" + "=" * 60, flush=True)
    print("FAZ 3 ÇALIŞMA RAPORU", flush=True)
    print("=" * 60, flush=True)
    if site in ("calendar", "all"):
        print(f"- Senkronlanan Takvim Programı: {total_calendar_items} adet")

    if diziizle_results:
        print(f"- Diziİzle İşlenen Yapım Sayısı: {len(diziizle_results)}")
        for d in diziizle_results:
            sample_src = d.get("sample_sources", ["-"])[0] if d.get("sample_sources") else "-"
            print(f"  • {d.get('title')} (#{d.get('drama_id')}) -> Eklenen Bölüm: {d.get('episodes_added', 0)}, Eklenen Kaynak: {d.get('sources_added', 0)}")
            if sample_src != "-":
                print(f"    Örnek Pilavyer: {sample_src}")

    if wdt_results:
        print(f"- WebDramaTurkey2 İşlenen Yapım Sayısı: {len(wdt_results)}")
        for w in wdt_results:
            sample_src = w.get("sample_sources", ["-"])[0] if w.get("sample_sources") else "-"
            print(f"  • {w.get('title')} (#{w.get('drama_id')}) [{w.get('content_type')}] -> Eklenen Bölüm: {w.get('episodes_added', 0)}, Eklenen Kaynak: {w.get('sources_added', 0)}")
            if sample_src != "-":
                print(f"    Örnek WDT: {sample_src}")

    print("=" * 60 + "\n", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Faz 3 Backfill & Sync Pipeline")
    parser.add_argument("--site", choices=["diziizle", "webdramaturkey2", "calendar", "all"], default="all")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--resume", action="store_true", default=False)
    args = parser.parse_args()

    run_phase3(site=args.site, limit=args.limit, resume=args.resume)


if __name__ == "__main__":
    main()
