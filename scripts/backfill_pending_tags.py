#!/usr/bin/env python3
"""
Backfill Pending Tags for KoUp Episodes Archive.

Finds all episodes in webdrama_archive.db that currently have zero playable sources,
and tags them as 'pending' with pending_since and last_source_check timestamps.
Does NOT run the Supabase/R2 sync for all dramas (too heavy for a backfill).

CLI Usage:
  python scripts/backfill_pending_tags.py --dry-run
  python scripts/backfill_pending_tags.py
"""

import sys
import os
import time
import argparse
import sqlite3

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection, DB_PATH
from scrapers.pending_sources import ensure_pending_columns


def run_backfill(dry_run: bool = False):
    print("=" * 60)
    print("KoUp Arşiv Bekleyen Kaynak (Pending) Etiketleme Backfill")
    print("=" * 60)

    start_time = time.time()
    conn = get_connection()
    ensure_pending_columns(conn)
    cur = conn.cursor()

    # 1. Total episodes count
    cur.execute("SELECT COUNT(*) FROM episodes")
    total_episodes = cur.fetchone()[0]

    # 2. Query episodes with zero sources
    zero_source_query = """
        SELECT e.id, e.drama_id
        FROM episodes e
        LEFT JOIN (
            SELECT DISTINCT episode_id
            FROM episode_sources
            WHERE direct_url IS NOT NULL
              AND direct_url != ''
              AND direct_url != 'dead'
              AND (provider IS NULL OR provider != 'dead')
        ) s ON e.id = s.episode_id
        WHERE s.episode_id IS NULL
    """
    cur.execute(zero_source_query)
    zero_ep_rows = cur.fetchall()
    zero_source_count = len(zero_ep_rows)
    affected_drama_ids = set(r[1] for r in zero_ep_rows)
    affected_dramas_count = len(affected_drama_ids)

    # 3. Check already pending vs newly needing tag
    cur.execute(
        """
        SELECT COUNT(*)
        FROM episodes e
        LEFT JOIN (
            SELECT DISTINCT episode_id
            FROM episode_sources
            WHERE direct_url IS NOT NULL
              AND direct_url != ''
              AND direct_url != 'dead'
              AND (provider IS NULL OR provider != 'dead')
        ) s ON e.id = s.episode_id
        WHERE s.episode_id IS NULL AND e.source_status = 'pending'
        """
    )
    already_pending_count = cur.fetchone()[0]
    to_tag_count = zero_source_count - already_pending_count

    print(f"Toplam Bölüm Sayısı: {total_episodes:,}")
    print(f"Sıfır Kaynaklı (Bekleyen) Bölüm Sayısı: {zero_source_count:,}")
    print(f"  - Halihazırda 'pending' olan: {already_pending_count:,}")
    print(f"  - Yeni etiketlenecek bölüm sayısı: {to_tag_count:,}")
    print(f"Etkilenen Yapım (Drama) Sayısı: {affected_dramas_count:,}")

    if dry_run:
        print("\n[DRY-RUN] Simülasyon tamamlandı. Veritabanında hiçbir değişiklik yapılmadı.")
        conn.close()
        return {
            "total_episodes": total_episodes,
            "zero_sources": zero_source_count,
            "already_pending": already_pending_count,
            "to_tag": to_tag_count,
            "affected_dramas": affected_dramas_count,
            "dry_run": True,
        }

    print("\n[İŞLENİYOR] SQLite üzerinde etiketleme uygulanıyor...")
    # Tag all zero source episodes as pending
    update_sql = """
        UPDATE episodes
        SET source_status = 'pending',
            pending_since = COALESCE(pending_since, CURRENT_TIMESTAMP),
            last_source_check = NULL,
            source_check_attempts = 0
        WHERE id IN (
            SELECT e.id
            FROM episodes e
            LEFT JOIN (
                SELECT DISTINCT episode_id
                FROM episode_sources
                WHERE direct_url IS NOT NULL
                  AND direct_url != ''
                  AND direct_url != 'dead'
                  AND (provider IS NULL OR provider != 'dead')
            ) s ON e.id = s.episode_id
            WHERE s.episode_id IS NULL
        )
    """
    cur.execute(update_sql)
    tagged_rows = cur.rowcount
    conn.commit()

    # Clear any erroneous pending tag on episodes that DO have sources
    cleanup_sql = """
        UPDATE episodes
        SET source_status = NULL,
            pending_since = NULL,
            last_source_check = CURRENT_TIMESTAMP
        WHERE source_status = 'pending'
          AND id IN (
            SELECT DISTINCT episode_id
            FROM episode_sources
            WHERE direct_url IS NOT NULL
              AND direct_url != ''
              AND direct_url != 'dead'
              AND (provider IS NULL OR provider != 'dead')
          )
    """
    cur.execute(cleanup_sql)
    cleared_rows = cur.rowcount
    conn.commit()

    # Checkpoint WAL
    try:
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    except Exception:
        pass

    conn.close()
    elapsed = time.time() - start_time

    print(f"✓ Başarıyla {tagged_rows:,} bölüm 'pending' olarak etiketlendi.")
    if cleared_rows > 0:
        print(f"✓ {cleared_rows:,} hatalı etiket temizlendi.")
    print(f"✓ Toplam {affected_dramas_count:,} yapım etkilendi.")
    print(f"İşlem Süresi: {elapsed:.2f} saniye.")
    print("=" * 60)

    return {
        "total_episodes": total_episodes,
        "zero_sources": zero_source_count,
        "tagged_episodes": tagged_rows,
        "cleared_episodes": cleared_rows,
        "affected_dramas": affected_dramas_count,
        "elapsed_seconds": elapsed,
        "dry_run": False,
    }


def main():
    parser = argparse.ArgumentParser(description="KoUp Zero-Source Episodes Backfill")
    parser.add_argument("--dry-run", action="store_true", help="Preview without modifying DB")
    args = parser.parse_args()

    run_backfill(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
