"""
Comprehensive Archive Sequence Gap Healer
-----------------------------------------
1. Normalizes title-number false outliers (e.g. 304, 501, 999).
2. Detects ALL sequence gaps across all series and seasons where max_ep <= 200.
3. Inserts pending placeholder episodes for every missing episode number (1..max_ep).
4. Re-syncs bundles to local disk, Cloudflare R2 (sources/{id}.json), and Supabase public.episodes.
"""

import sys
import os
import sqlite3
import json
from collections import defaultdict

# Add root directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    _load_supabase_creds,
    _load_r2_creds,
    upload_to_r2,
)

def heal_all_gaps():
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    dramas_to_resync = set()

    print("=" * 60)
    print("STEP 1: NORMALIZING TITLE-NUMBER FALSE OUTLIERS")
    print("=" * 60)

    # 1.1 Roommates Of Poongduck 304 (id: 19964)
    # Episode 304 was actually episode 1 from a scraper mistake
    cur.execute("SELECT id FROM episodes WHERE drama_id = 19964 AND episode_number = 304")
    row = cur.fetchone()
    if row:
        bad_ep_id = row[0]
        cur.execute("SELECT id FROM episodes WHERE drama_id = 19964 AND episode_number = 1")
        ep1_row = cur.fetchone()
        if ep1_row:
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE episode_id = ?", (ep1_row[0], bad_ep_id))
            cur.execute("DELETE FROM episodes WHERE id = ?", (bad_ep_id,))
            print("  Fixed Drama 19964 (Roommates of Poongduck 304): merged ep 304 into ep 1.")
            dramas_to_resync.add(19964)

    # 1.2 Strike Witches: 501 Butai Hasshin Shimasu! (id: 10813)
    # Episode 501 is the movie special
    cur.execute("SELECT id FROM episodes WHERE drama_id = 10813 AND episode_number = 501")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 10813 (Strike Witches): moved ep 501 to special S0E1.")
        dramas_to_resync.add(10813)

    # 1.3 Ginga Tetsudou 999: Eternal Fantasy (id: 7445)
    # Episode 999 is actually episode 1
    cur.execute("SELECT id FROM episodes WHERE drama_id = 7445 AND episode_number = 999")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET episode_number = 1, episode_name = '1. Bölüm' WHERE id = ?", (row[0],))
        print("  Fixed Drama 7445 (Ginga Tetsudou 999): normalized ep 999 to ep 1.")
        dramas_to_resync.add(7445)

    # 1.4 Shiki (id: 10524)
    # Episodes 205 and 215 are OVA 20.5 and 21.5
    cur.execute("SELECT id, episode_number FROM episodes WHERE drama_id = 10524 AND episode_number IN (205, 215)")
    for sh_id, sh_num in cur.fetchall():
        new_num = 1 if sh_num == 205 else 2
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = ?, episode_type = 'special' WHERE id = ?", (new_num, sh_id))
        print(f"  Fixed Drama 10524 (Shiki): moved ep {sh_num} to special S0E{new_num}.")
        dramas_to_resync.add(10524)

    # 1.5 Sword Art Online (id: 10867)
    # Episode 145 is the Extra Edition special
    cur.execute("SELECT id FROM episodes WHERE drama_id = 10867 AND episode_number = 145")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 10867 (Sword Art Online): moved ep 145 to special S0E1.")
        dramas_to_resync.add(10867)

    # 1.6 Link Click (id: 1197)
    # Episode 55 is a chibi/special
    cur.execute("SELECT id FROM episodes WHERE drama_id = 1197 AND episode_number = 55")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 1197 (Link Click): moved ep 55 to special S0E1.")
        dramas_to_resync.add(1197)

    # 1.7 Tengen Toppa Gurren Lagann (id: 10984)
    # Episode 55 is special
    cur.execute("SELECT id FROM episodes WHERE drama_id = 10984 AND episode_number = 55")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 10984 (Gurren Lagann): moved ep 55 to special S0E1.")
        dramas_to_resync.add(10984)

    # 1.8 SK8 the Infinity (id: 10663)
    # Episode 95 is special 9.5
    cur.execute("SELECT id FROM episodes WHERE drama_id = 10663 AND episode_number = 95")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 10663 (SK8): moved ep 95 to special S0E1.")
        dramas_to_resync.add(10663)

    # 1.9 Necronomico no Cosmic Horror Show (id: 9491)
    cur.execute("SELECT id FROM episodes WHERE drama_id = 9491 AND episode_number = 59")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 9491 (Necronomico): moved ep 59 to special S0E1.")
        dramas_to_resync.add(9491)

    # 1.10 ViVid Strike! (id: 11420)
    cur.execute("SELECT id FROM episodes WHERE drama_id = 11420 AND episode_number = 75")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 11420 (ViVid Strike): moved ep 75 to special S0E1.")
        dramas_to_resync.add(11420)

    # 1.11 Youjo Senki (id: 11651)
    cur.execute("SELECT id FROM episodes WHERE drama_id = 11651 AND episode_number = 65")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 11651 (Youjo Senki): moved ep 65 to special S0E1.")
        dramas_to_resync.add(11651)

    # 1.12 Wan Ren Zhi Shang (id: 11442)
    cur.execute("SELECT id FROM episodes WHERE drama_id = 11442 AND episode_number = 50")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE episodes SET season_number = 0, episode_number = 1, episode_type = 'special' WHERE id = ?", (row[0],))
        print("  Fixed Drama 11442 (Wan Ren Zhi Shang): moved ep 50 to special S0E1.")
        dramas_to_resync.add(11442)

    conn.commit()

    print("\n" + "=" * 60)
    print("STEP 2: DETECTING ALL SEQUENCE GAPS ACROSS ARCHIVE")
    print("=" * 60)

    cur.execute("""
        SELECT e.drama_id, COALESCE(e.season_number, 1), e.episode_number
        FROM episodes e
        JOIN dramas d ON e.drama_id = d.id
        ORDER BY e.drama_id, COALESCE(e.season_number, 1), e.episode_number
    """)
    drama_seasons = defaultdict(lambda: defaultdict(set))
    for d_id, s_num, e_num in cur.fetchall():
        if e_num is not None:
            drama_seasons[d_id][s_num].add(e_num)

    total_placeholders = 0
    gapped_series_count = 0

    for d_id, seasons in drama_seasons.items():
        series_touched = False
        for s_num, ep_nums in seasons.items():
            if not ep_nums:
                continue
            # Ignore special seasons (season 0)
            if s_num == 0:
                continue
            
            min_ep = min(ep_nums)
            max_ep = max(ep_nums)

            # Cap max_ep at 200 for regular seasons
            if max_ep > 200:
                continue

            # In normal TV seasons, episodes run from 1 to max_ep
            expected = set(range(1, max_ep + 1))
            missing = expected - ep_nums

            if missing:
                series_touched = True
                for m_ep in sorted(missing):
                    cur.execute("""
                        INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, source_status)
                        VALUES (?, ?, ?, ?, ?, 'pending')
                    """, (d_id, s_num, m_ep, f"{m_ep}. Bölüm", f"pending://gap/{d_id}/{s_num}/{m_ep}"))
                    total_placeholders += 1

        if series_touched:
            gapped_series_count += 1
            dramas_to_resync.add(d_id)

    conn.commit()
    print(f"Filled {total_placeholders} missing episode placeholders across {gapped_series_count} series!")

    print("\n" + "=" * 60)
    print(f"STEP 3: RE-SYNCING BUNDLES, CLOUDFLARE R2 & SUPABASE ({len(dramas_to_resync)} SERIES)")
    print("=" * 60)

    synced_count = 0
    for idx, d_id in enumerate(sorted(dramas_to_resync), 1):
        try:
            sync_drama_bundle_and_counts(conn, cur, d_id)
            synced_count += 1
            if idx % 25 == 0 or idx == len(dramas_to_resync):
                print(f"  [{idx}/{len(dramas_to_resync)}] Synced Drama ID {d_id} to R2 & Supabase...")
        except Exception as e:
            print(f"  [ERROR] Syncing drama {d_id}: {e}")

    # Checkpoint SQLite WAL
    try:
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        print("\nSQLite WAL checkpointed successfully.")
    except Exception as e:
        print(f"WAL checkpoint note: {e}")

    conn.close()
    print("\n" + "=" * 60)
    print(f"ALL DONE! {total_placeholders} placeholders filled, {synced_count} series synced to R2 & Supabase.")
    print("=" * 60)

if __name__ == "__main__":
    heal_all_gaps()
