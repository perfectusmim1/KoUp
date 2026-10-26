"""
Database Maintenance Script: Fix Episode Title Icons & Scraper Residue
- Iterates over all episodes in webdrama_archive.db
- Strips play icons (▶, ►, etc.), special symbols, duplicate episode numbers and scraper noise
- Uses scrapers.multisite.clean_episode_title
- Reports the number of updated rows and sample diffs
"""

import os
import sys
import sqlite3

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.multisite import clean_episode_title


def main():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path):
        print(f"Error: {db_path} not found.")
        return 1

    print(f"[FIX_TITLES] Opening database: {db_path}")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT e.id, e.drama_id, e.season_number, e.episode_number, e.episode_name, d.title
        FROM episodes e
        LEFT JOIN dramas d ON d.id = e.drama_id
        WHERE e.episode_name IS NOT NULL
    """)
    rows = cur.fetchall()
    total_scanned = len(rows)
    print(f"[FIX_TITLES] Total episodes to inspect: {total_scanned:,}")

    updates = []
    samples = []

    for ep_id, drama_id, season, number, old_name, drama_title in rows:
        s_num = season or 1
        e_num = number or 1
        cleaned = clean_episode_title(old_name, s_num, e_num, drama_title=drama_title)

        if cleaned != old_name:
            updates.append((cleaned, ep_id))
            if len(samples) < 20:
                samples.append((ep_id, drama_title or f"Drama #{drama_id}", old_name, cleaned))

    print(f"[FIX_TITLES] Identified {len(updates):,} episodes needing cleanup.")

    if updates:
        batch_size = 5000
        for i in range(0, len(updates), batch_size):
            batch = updates[i : i + batch_size]
            cur.executemany("UPDATE episodes SET episode_name=? WHERE id=?", batch)
            conn.commit()

        print(f"[FIX_TITLES] Successfully updated {len(updates):,} rows in SQLite.")

        try:
            cur.execute("PRAGMA wal_checkpoint(PASSIVE);")
        except Exception:
            pass

    print("\n[FIX_TITLES] Sample cleaned titles (first 20):")
    for ep_id, d_title, before, after in samples:
        print(f"  #{ep_id} [{d_title}]: {repr(before)} -> {repr(after)}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
