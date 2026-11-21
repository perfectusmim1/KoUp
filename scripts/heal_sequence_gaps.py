"""
Archive Sequence Gap & Phantom Placeholder Cleaner
--------------------------------------------------
1. Normalizes title-number false outliers (e.g. 304, 501, 999) and single-episode >1 entries.
2. NEVER inserts fake `pending://gap` placeholders (banned!).
3. Purges any remaining 0-source `pending://gap/%` placeholder rows and reconciles
   source-bearing ones to `source_status = 'active'`.
4. Reports real internal sequence gaps (1..max_ep) for actual scraping recovery.
"""

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts


def heal_all_gaps(no_remote_sync=False, dry_run=False, db_path=None):
    db_path = db_path or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webdrama_archive.db"
    )
    conn = sqlite3.connect(db_path, timeout=60.0)
    cur = conn.cursor()
    cur.execute("PRAGMA busy_timeout = 60000;")

    dramas_to_resync = set()

    print("=" * 60)
    print(f"STEP 1: NORMALIZING TITLE-NUMBER FALSE OUTLIERS ({'DRY-RUN' if dry_run else 'APPLY'})")
    print("=" * 60)

    # 1.1 Roommates Of Poongduck 304 (id: 19964)
    cur.execute("SELECT id FROM episodes WHERE drama_id = 19964 AND episode_number = 304")
    row = cur.fetchone()
    if row:
        bad_ep_id = row[0]
        cur.execute("SELECT id FROM episodes WHERE drama_id = 19964 AND episode_number = 1")
        ep1_row = cur.fetchone()
        if ep1_row and not dry_run:
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE episode_id = ?", (ep1_row[0], bad_ep_id))
            cur.execute("DELETE FROM episodes WHERE id = ?", (bad_ep_id,))
        print("  [OUTLIER] Drama 19964 (Roommates of Poongduck 304): ep 304 -> ep 1")
        dramas_to_resync.add(19964)

    special_fixes = [
        (10813, 501, 1, "Strike Witches ep 501 -> S0E1"),
        (10524, 205, 1, "Shiki ep 205 -> S0E1"),
        (10524, 215, 2, "Shiki ep 215 -> S0E2"),
        (10867, 145, 1, "Sword Art Online ep 145 -> S0E1"),
        (1197, 55, 1, "Link Click ep 55 -> S0E1"),
        (10984, 55, 1, "Gurren Lagann ep 55 -> S0E1"),
        (10663, 95, 1, "SK8 ep 95 -> S0E1"),
        (9491, 59, 1, "Necronomico ep 59 -> S0E1"),
        (11420, 75, 1, "ViVid Strike ep 75 -> S0E1"),
        (11651, 65, 1, "Youjo Senki ep 65 -> S0E1"),
        (11442, 50, 1, "Wan Ren Zhi Shang ep 50 -> S0E1"),
    ]
    for did, old_ep, new_ep, msg in special_fixes:
        cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ?", (did, old_ep))
        row = cur.fetchone()
        if row:
            if not dry_run:
                cur.execute(
                    "UPDATE episodes SET season_number = 0, episode_number = ?, episode_type = 'special' WHERE id = ?",
                    (new_ep, row[0]),
                )
            print(f"  [OUTLIER] Drama {did}: {msg}")
            dramas_to_resync.add(did)

    cur.execute("SELECT id FROM episodes WHERE drama_id = 7445 AND episode_number = 999")
    row = cur.fetchone()
    if row:
        if not dry_run:
            cur.execute("UPDATE episodes SET episode_number = 1, episode_name = '1. Bölüm' WHERE id = ?", (row[0],))
        print("  [OUTLIER] Drama 7445 (Ginga Tetsudou 999): ep 999 -> ep 1")
        dramas_to_resync.add(7445)

    if not dry_run:
        conn.commit()

    print("\n" + "=" * 60)
    print("STEP 2: PURGING 0-SOURCE pending://gap PLACEHOLDERS (NO FAKE ROWS)")
    print("=" * 60)

    zero_gaps = cur.execute(
        """
        SELECT e.id, e.drama_id
        FROM episodes e
        WHERE e.episode_url LIKE 'pending://gap/%'
          AND NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
        """
    ).fetchall()
    reconcile_gaps = cur.execute(
        """
        SELECT e.id, e.drama_id
        FROM episodes e
        WHERE e.episode_url LIKE 'pending://gap/%'
          AND (e.source_status IS NULL OR e.source_status = 'pending')
          AND EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
        """
    ).fetchall()

    print(f"  0-source pending://gap rows to delete   : {len(zero_gaps)}")
    print(f"  Sourced pending://gap rows to reconcile : {len(reconcile_gaps)}")

    if not dry_run:
        if zero_gaps:
            zids = [r[0] for r in zero_gaps]
            for _, did in zero_gaps:
                dramas_to_resync.add(did)
            for i in range(0, len(zids), 500):
                chunk = zids[i : i + 500]
                ph = ",".join("?" * len(chunk))
                cur.execute(f"DELETE FROM episodes WHERE id IN ({ph})", chunk)
        if reconcile_gaps:
            rids = [r[0] for r in reconcile_gaps]
            for _, did in reconcile_gaps:
                dramas_to_resync.add(did)
            for i in range(0, len(rids), 500):
                chunk = rids[i : i + 500]
                ph = ",".join("?" * len(chunk))
                cur.execute(
                    f"UPDATE episodes SET source_status = 'active', pending_since = NULL WHERE id IN ({ph})",
                    chunk,
                )
        conn.commit()

    print("\n" + "=" * 60)
    print("STEP 3: AUDITING REAL SEQUENCE GAPS (READ-ONLY REPORT)")
    print("=" * 60)

    cur.execute(
        """
        SELECT e.drama_id, COALESCE(e.season_number, 1), e.episode_number
        FROM episodes e
        WHERE COALESCE(e.season_number, 1) > 0
        ORDER BY e.drama_id, COALESCE(e.season_number, 1), e.episode_number
        """
    )
    drama_seasons = defaultdict(lambda: defaultdict(set))
    for d_id, s_num, e_num in cur.fetchall():
        if e_num is not None:
            drama_seasons[d_id][s_num].add(e_num)

    total_gap_slots = 0
    gapped_series_count = 0
    for d_id, seasons in drama_seasons.items():
        has_gap = False
        for s_num, ep_nums in seasons.items():
            if not ep_nums:
                continue
            min_ep, max_ep = min(ep_nums), max(ep_nums)
            if max_ep > 2500:
                continue
            missing = set(range(min_ep, max_ep + 1)) - ep_nums
            if missing:
                has_gap = True
                total_gap_slots += len(missing)
        if has_gap:
            gapped_series_count += 1

    print(f"  Real internal sequence gaps: {gapped_series_count} series, {total_gap_slots} missing slots (use recover_and_heal_sources.py to scrape).")

    if not dry_run and not no_remote_sync and dramas_to_resync:
        print(f"\nSTEP 4: RE-SYNCING {len(dramas_to_resync)} AFFECTED DRAMAS TO R2 & SUPABASE")
        for idx, d_id in enumerate(sorted(dramas_to_resync), 1):
            try:
                sync_drama_bundle_and_counts(conn, cur, d_id)
                if idx % 25 == 0 or idx == len(dramas_to_resync):
                    print(f"  [{idx}/{len(dramas_to_resync)}] Synced Drama ID {d_id}")
            except Exception as e:
                print(f"  [ERROR] Syncing drama {d_id}: {e}")

    conn.close()
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': dry_run, 'zeroPendingDeleted': len(zero_gaps), 'reconciled': len(reconcile_gaps), 'gappedSeries': gapped_series_count, 'gapSlots': total_gap_slots})}", flush=True)
    return sorted(list(dramas_to_resync))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--dry-run", action="store_true", help="Preview without mutating SQLite/R2/Supabase")
    parser.add_argument("--no-remote-sync", action="store_true", help="Skip R2 and Supabase sync")
    args = parser.parse_args()
    heal_all_gaps(no_remote_sync=args.no_remote_sync, dry_run=args.dry_run, db_path=args.db)
    sys.exit(0)
