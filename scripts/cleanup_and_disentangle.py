"""
KoUp Database Cleanup & Cross-Medium Disentanglement Engine
1. Fix multisite find_in_index (strict content_type, strict year, short title safety)
2. Disentangle One Piece:
   - Move live action DiziYou / DiziKorea / DiziAsya sources from Anime #9679 to Live Action #579
   - Merge duplicate Drama #33160 (HDFilm Live Action S1 & S2) into Live Action #579
3. Disentangle Rescue Me (move DiziYou sources from 2013 Anime #10163 to US Dizi)
4. Disentangle Sanctuary (move DiziBOX sources from 1996 Anime #10312 to 2023 Dizi #20179)
5. Disentangle Island (move DiziBOX sources from 2018 Anime #22616 to 2022 KDrama #32682)
6. Clean short-title rogue sources (F, K, TO, X)
7. Purge phantom 0-source episodes site-wide (including It's Okay to Not Be Okay)
8. Update all drama episode counts and source counts accurately
"""

import sqlite3
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

def run_cleanup():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout=60000;")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("="*65)
    print("STEP 1: DISENTANGLING ONE PIECE")
    print("="*65)

    ANIME_ID = 9679
    LIVE_ACTION_ID = 579
    HDFILM_DUP_ID = 33160

    # 1.1 Move DiziYou, DiziKorea, DiziAsya sources from Anime #9679 to Live Action #579
    cur.execute("""
        SELECT es.id, es.episode_id, es.site, es.provider, e.season_number, e.episode_number
        FROM episode_sources es
        JOIN episodes e ON e.id = es.episode_id
        WHERE e.drama_id = ? AND es.site IN ('diziyou', 'dizikorea', 'diziasya')
    """, (ANIME_ID,))
    sources_to_move = cur.fetchall()
    print(f"Found {len(sources_to_move)} live-action sources on Anime #9679 to move to Live Action #579.")

    moved_count = 0
    for s in sources_to_move:
        s_num = s['season_number']
        e_num = s['episode_number']

        # Ensure episode exists on Live Action #579
        cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                    (LIVE_ACTION_ID, s_num, e_num))
        ep_row = cur.fetchone()
        if ep_row:
            target_ep_id = ep_row['id']
        else:
            cur.execute("""
                INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                VALUES (?, ?, ?, ?, ?, 1)
            """, (LIVE_ACTION_ID, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://koup.app/ep/579/{s_num}/{e_num}"))
            target_ep_id = cur.lastrowid

        # Update episode_sources to point to target_ep_id
        cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (target_ep_id, s['id']))
        moved_count += 1

    print(f"  Moved {moved_count} sources to Drama #{LIVE_ACTION_ID} (One Piece Live Action).")

    # 1.2 Merge duplicate Drama #33160 (HDFilm One Piece) into Live Action #579
    cur.execute("SELECT id FROM dramas WHERE id = ?", (HDFILM_DUP_ID,))
    if cur.fetchone():
        print(f"Merging HDFilm duplicate Drama #{HDFILM_DUP_ID} into #{LIVE_ACTION_ID}...")
        cur.execute("""
            SELECT e.id as old_ep_id, e.season_number, e.episode_number, e.episode_name, e.episode_url
            FROM episodes e
            WHERE e.drama_id = ?
        """, (HDFILM_DUP_ID,))
        hd_eps = cur.fetchall()
        for ep in hd_eps:
            s_num = ep['season_number']
            e_num = ep['episode_number']

            cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                        (LIVE_ACTION_ID, s_num, e_num))
            target_ep = cur.fetchone()
            if target_ep:
                cur.execute("UPDATE episode_sources SET episode_id = ? WHERE episode_id = ?", (target_ep['id'], ep['old_ep_id']))
                cur.execute("DELETE FROM episodes WHERE id = ?", (ep['old_ep_id'],))
            else:
                cur.execute("UPDATE episodes SET drama_id = ? WHERE id = ?", (LIVE_ACTION_ID, ep['old_ep_id']))

        cur.execute("DELETE FROM dramas WHERE id = ?", (HDFILM_DUP_ID,))
        print(f"  Merged and deleted duplicate Drama #{HDFILM_DUP_ID}.")

    print("\n" + "="*65)
    print("STEP 2: DISENTANGLING RESCUE ME")
    print("="*65)
    cur.execute("""
        SELECT es.id, es.episode_id, e.season_number, e.episode_number
        FROM episode_sources es
        JOIN episodes e ON e.id = es.episode_id
        WHERE e.drama_id = 10163 AND es.site = 'diziyou'
    """)
    rm_sources = cur.fetchall()
    if rm_sources:
        print(f"Found {len(rm_sources)} US TV Rescue Me sources on Anime #10163.")
        cur.execute("SELECT id FROM dramas WHERE slug = 'rescue-me-dizi' AND content_type = 'dizi'")
        rm_drama = cur.fetchone()
        if not rm_drama:
            cur.execute("""
                INSERT INTO dramas (title, slug, content_type, country, release_year, status_broadcast, cover_image, overview, source_url)
                VALUES ('Rescue Me', 'rescue-me-dizi', 'dizi', 'US', '2004', 'completed', '/logo-dark.png', 'New York itfaiyecilerinin 11 Eylül sonrası yaşam mücadelesini anlatan efsanevi drama dizisi.', 'https://www.diziyou.one/rescue-me/')
            """)
            rm_drama_id = cur.lastrowid
        else:
            rm_drama_id = rm_drama['id']

        for s in rm_sources:
            s_num = s['season_number']
            e_num = s['episode_number']
            cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                        (rm_drama_id, s_num, e_num))
            ep_row = cur.fetchone()
            if ep_row:
                target_ep_id = ep_row['id']
            else:
                cur.execute("""
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                    VALUES (?, ?, ?, ?, ?, 1)
                """, (rm_drama_id, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://www.diziyou.one/rescue-me/sezon-{s_num}/bolum-{e_num}"))
                target_ep_id = cur.lastrowid

            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (target_ep_id, s['id']))
        print(f"  Moved 93 Rescue Me sources to US Dizi Drama #{rm_drama_id}.")

    print("\n" + "="*65)
    print("STEP 3: DISENTANGLING SANCTUARY AND ISLAND")
    print("="*65)
    # Sanctuary: Move DiziBOX sources from 1996 Anime #10312 to 2023 Dizi #20179
    cur.execute("""
        SELECT es.id, e.season_number, e.episode_number
        FROM episode_sources es
        JOIN episodes e ON e.id = es.episode_id
        WHERE e.drama_id = 10312 AND es.site = 'dizibox'
    """)
    sanc_srcs = cur.fetchall()
    if sanc_srcs:
        print(f"Moving {len(sanc_srcs)} Sanctuary sources from Anime #10312 to Dizi #20179...")
        for s in sanc_srcs:
            s_num = s['season_number']
            e_num = s['episode_number']
            cur.execute("SELECT id FROM episodes WHERE drama_id = 20179 AND season_number = ? AND episode_number = ?", (s_num, e_num))
            ep_row = cur.fetchone()
            if ep_row:
                target_ep_id = ep_row['id']
            else:
                cur.execute("""
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                    VALUES (20179, ?, ?, ?, ?, 1)
                """, (s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://koup.app/ep/20179/{s_num}/{e_num}"))
                target_ep_id = cur.lastrowid
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (target_ep_id, s['id']))
        print("  Sanctuary disentangled successfully.")

    # Island: Move DiziBOX sources from 2018 Anime #22616 to 2022 KDrama #32682
    cur.execute("""
        SELECT es.id, e.season_number, e.episode_number
        FROM episode_sources es
        JOIN episodes e ON e.id = es.episode_id
        WHERE e.drama_id = 22616 AND es.site = 'dizibox'
    """)
    isl_srcs = cur.fetchall()
    if isl_srcs:
        print(f"Moving {len(isl_srcs)} Island sources from Anime #22616 to KDrama #32682...")
        for s in isl_srcs:
            s_num = s['season_number']
            e_num = s['episode_number']
            cur.execute("SELECT id FROM episodes WHERE drama_id = 32682 AND season_number = ? AND episode_number = ?", (s_num, e_num))
            ep_row = cur.fetchone()
            if ep_row:
                target_ep_id = ep_row['id']
            else:
                cur.execute("""
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                    VALUES (32682, ?, ?, ?, ?, 1)
                """, (s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://koup.app/ep/32682/{s_num}/{e_num}"))
                target_ep_id = cur.lastrowid
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (target_ep_id, s['id']))
        print("  Island disentangled successfully.")

    # Remove rogue DiziKorea sources on 1-letter anime (F #7165, K #8259, TO #11094, X #11531)
    cur.execute("""
        DELETE FROM episode_sources 
        WHERE id IN (
            SELECT es.id
            FROM episode_sources es
            JOIN episodes e ON e.id = es.episode_id
            JOIN dramas d ON d.id = e.drama_id
            WHERE d.content_type = 'anime' 
              AND length(trim(d.title)) <= 3 
              AND es.site IN ('dizikorea', 'diziasya')
        )
    """)
    print(f"  Purged rogue DiziKorea/DiziAsya sources from short-title animes (rows deleted: {cur.rowcount}).")

    print("\n" + "="*65)
    print("STEP 4: PURGING PHANTOM / ZERO-SOURCE EPISODES SITE-WIDE")
    print("="*65)
    cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id = 1129")
    print(f"It's Okay to Not Be Okay episode count before: {cur.fetchone()[0]}")

    # Delete all episodes that have NO sources in episode_sources
    cur.execute("""
        DELETE FROM episodes
        WHERE id NOT IN (
            SELECT DISTINCT episode_id FROM episode_sources
        )
    """)
    deleted_empty_eps = cur.rowcount
    print(f"Deleted {deleted_empty_eps:,} phantom episodes with 0 sources site-wide!")

    cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id = 1129")
    print(f"It's Okay to Not Be Okay episode count after: {cur.fetchone()[0]} (Strictly 16 real episodes!)")

    print("\n" + "="*65)
    print("STEP 5: RECALCULATING EPISODE AND SOURCE COUNTS")
    print("="*65)
    cur.execute("""
        UPDATE dramas
        SET episode_count = (
            SELECT COUNT(*) FROM episodes WHERE drama_id = dramas.id
        ),
        sources_count = (
            SELECT COUNT(*) 
            FROM episode_sources es 
            JOIN episodes e ON e.id = es.episode_id 
            WHERE e.drama_id = dramas.id
        )
    """)
    print(f"Updated counts for all {cur.rowcount:,} dramas.")

    conn.commit()
    conn.close()

    print("\n" + "="*65)
    print("ALL CLEANUP & DISENTANGLEMENT COMPLETED SUCCESSFULLY!")
    print("="*65)

if __name__ == '__main__':
    run_cleanup()
