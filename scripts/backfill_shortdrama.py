#!/usr/bin/env python3
"""
Backfill Short Drama Pipeline CLI
Orchestrates ingestion, deduplication, and cloud sync for short drama providers:
- KoreDizi (koredizi)
- Shortİzle (shortizle)
- DramaVadisi (dramavadisi)
- DramaBox (dramabox match-only)

Usage:
  python scripts/backfill_shortdrama.py --site all --limit 5
  python scripts/backfill_shortdrama.py --site koredizi --limit 10
  python scripts/backfill_shortdrama.py --site dramavadisi --limit 5 --sync-cloud
"""

import argparse
import os
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scrapers.shortdrama.common import load_env, get_db_connection
from scrapers.shortdrama.koredizi import KoreDiziScraper
from scrapers.shortdrama.shortizle import ShortizleScraper
from scrapers.shortdrama.dramavadisi import DramaVadisiScraper
from scrapers.shortdrama.dramabox import DramaBoxScraper


def run_pipeline(site: str, limit: int = None, resume: bool = True, sync_cloud: bool = True):
    load_env()
    start_time = time.time()
    print("=" * 60)
    print(f"KoUp Short Drama Backfill Pipeline")
    print(f"Site Target : {site}")
    print(f"Limit       : {limit if limit is not None else 'UNLIMITED'}")
    print(f"Resume      : {resume}")
    print(f"Cloud Sync  : {sync_cloud}")
    print("=" * 60)

    # 1. KoreDizi
    if site in ("koredizi", "all"):
        print("\n>>> [1/4] Running KoreDizi Scraper...")
        koredizi = KoreDiziScraper()
        koredizi.run(limit=limit, resume=resume, sync_cloud=sync_cloud)

    # 2. DramaVadisi
    if site in ("dramavadisi", "all"):
        print("\n>>> [2/4] Running DramaVadisi Scraper...")
        dramavadisi = DramaVadisiScraper()
        dramavadisi.run(limit=limit, resume=resume, sync_cloud=sync_cloud)

    # 3. Shortİzle
    if site in ("shortizle", "all"):
        print("\n>>> [3/4] Running Shortİzle Scraper...")
        shortizle = ShortizleScraper()
        shortizle.run(limit=limit, resume=resume, sync_cloud=sync_cloud)

    # 4. DramaBox (Matching & Free Episode Backfill)
    if site in ("dramabox", "all"):
        print("\n>>> [4/4] Running DramaBox Free Episode Matcher...")
        dramabox = DramaBoxScraper()
        dramabox.run(limit=limit, resume=resume, sync_cloud=sync_cloud)

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"Short Drama Backfill Completed in {elapsed:.2f} seconds.")
    print("=" * 60)

    # Output stats and cleanup any zero-source short dramas
    conn = get_db_connection()
    try:
        cur = conn.cursor()

        # Zero-source purge safeguard
        cur.execute("""
            SELECT d.id, d.title
            FROM dramas d
            WHERE (d.content_type = 'kisa_drama' OR d.categories LIKE '%Kısa Drama%')
              AND NOT EXISTS (
                  SELECT 1 FROM episodes e
                  JOIN episode_sources s ON s.episode_id = e.id
                  WHERE e.drama_id = d.id AND s.direct_url IS NOT NULL AND s.direct_url != '' AND s.direct_url != 'dead'
              )
        """)
        empty_dramas = cur.fetchall()
        if empty_dramas:
            print(f"\n[SAFEPURGE] Found {len(empty_dramas)} short dramas with 0 playable sources. Purging to prevent empty listings...")
            for ed in empty_dramas:
                did = ed[0]
                cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (did,))
                cur.execute("DELETE FROM episodes WHERE drama_id = ?", (did,))
                cur.execute("DELETE FROM dramas WHERE id = ?", (did,))
            conn.commit()
            print(f"[SAFEPURGE] Successfully purged {len(empty_dramas)} zero-source dramas.")

        cur.execute("SELECT count(id) FROM dramas WHERE content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%'")
        total_dramas = cur.fetchone()[0]

        cur.execute("""
            SELECT count(DISTINCT s.id)
            FROM episode_sources s
            JOIN episodes e ON e.id = s.episode_id
            JOIN dramas d ON d.id = e.drama_id
            WHERE d.content_type = 'kisa_drama' OR d.categories LIKE '%Kısa Drama%'
        """)
        total_sources = cur.fetchone()[0]

        print(f"\nCurrent Archive Stats:")
        print(f"  Total Short Dramas : {total_dramas:,}")
        print(f"  Total Sources       : {total_sources:,}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill short dramas into KoUp Archive")
    parser.add_argument(
        "--site",
        choices=["koredizi", "shortizle", "dramavadisi", "dramabox", "all"],
        default="all",
        help="Target short drama provider (default: all)",
    )
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of titles to scrape per provider")
    parser.add_argument("--resume", dest="resume", action="store_true", default=True, help="Resume from last checkpoint (default: True)")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Ignore checkpoints and re-scrape all")
    parser.add_argument("--sync-cloud", dest="sync_cloud", action="store_true", default=True, help="Sync to Supabase & Cloudflare R2 (default: True)")
    parser.add_argument("--no-sync-cloud", dest="sync_cloud", action="store_false", help="Do not sync to Supabase & Cloudflare R2")

    args = parser.parse_args()
    run_pipeline(site=args.site, limit=args.limit, resume=args.resume, sync_cloud=args.sync_cloud)


if __name__ == "__main__":
    main()
