#!/usr/bin/env python3
"""
Cleans all advertising, discord addresses, URLs, and noisy credits from
episode_sources.fansub and episode_sources.source_name in webdrama_archive.db.
"""

import sys
import os
import sqlite3
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from scrapers.clean_fansub import clean_fansub_name, clean_source_name

DB_PATH = ROOT_DIR / "webdrama_archive.db"

def main():
    print(f"Connecting to {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    cur = conn.cursor()

    # 1. Fetch all rows where fansub IS NOT NULL
    print("Reading rows from episode_sources where fansub is not null...")
    cur.execute("SELECT id, fansub FROM episode_sources WHERE fansub IS NOT NULL")
    rows = cur.fetchall()
    print(f"Found {len(rows)} rows with non-null fansub.")

    updates = []
    for sid, fansub in rows:
        cleaned = clean_fansub_name(fansub)
        if cleaned != fansub:
            updates.append((cleaned, sid))

    print(f"Total fansub rows needing update: {len(updates)}")
    if updates:
        print("Applying fansub updates in chunks...")
        chunk_size = 5000
        for i in range(0, len(updates), chunk_size):
            chunk = updates[i:i + chunk_size]
            cur.executemany("UPDATE episode_sources SET fansub = ? WHERE id = ?", chunk)
            conn.commit()
            print(f"  Updated {min(i + chunk_size, len(updates))}/{len(updates)} rows...")

    # 2. Check and clean source_name if any contain URLs or discord
    print("\nChecking source_name for URLs or discord...")
    cur.execute("""
        SELECT id, source_name 
        FROM episode_sources 
        WHERE source_name LIKE '%http%' 
           OR source_name LIKE '%discord%' 
           OR source_name LIKE '%www.%'
    """)
    src_rows = cur.fetchall()
    print(f"Found {len(src_rows)} rows with potential ads in source_name.")
    src_updates = []
    for sid, sname in src_rows:
        cleaned = clean_source_name(sname)
        if cleaned != sname:
            src_updates.append((cleaned, sid))

    if src_updates:
        print(f"Updating {len(src_updates)} source_name rows...")
        cur.executemany("UPDATE episode_sources SET source_name = ? WHERE id = ?", src_updates)
        conn.commit()

    conn.close()
    print("\nDatabase cleanup complete successfully!")

if __name__ == "__main__":
    main()
