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

            # High priority Turkish series from our archive that currently rely on YouTube
            cur.execute("""
                SELECT DISTINCT d.id, d.title, d.slug 
                FROM dramas d
                JOIN episodes e ON e.drama_id = d.id
                JOIN episode_sources es ON es.episode_id = e.id
                WHERE es.provider = 'youtube' AND d.country = 'TR'
                LIMIT ?
            """, (limit,))
            yt_rows = cur.fetchall()
            targeted_slugs = [r["slug"] for r in yt_rows if r["slug"]]
            if targeted_slugs:
                print(f"[DIZIIZLE TARGET] YouTube kaynaklı {len(targeted_slugs)} Türk dizisi önceliklendiriliyor:", flush=True)
                for r in yt_rows:
                    print(f"  - #{r['id']} {r['title']} ({r['slug']})", flush=True)

            targeted_urls = [f"https://diziizle.wiki/dizi/{s}" for s in targeted_slugs]

            # Crawl targeted or recent diziizle series
            diziizle_results = crawl_diziizle_recent(
                cur=cur,
                conn=conn,
                idx=idx,
                limit=limit,
                max_episodes_per_series=25,
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
