import sqlite3
import re
import os
import sys
import time
import requests
import urllib3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

urllib3.disable_warnings()

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)
from scripts.recheck_pending_episodes import extract_sources_for_episode

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

def interpolate_missing_url(sample_url: str, old_ep_num: int, new_ep_num: int) -> str:
    if not sample_url:
        return None
    # Pattern 1: .../bolum-2 or ...-bolum-2
    p1 = re.sub(rf'([-_/])bolum[-_]({old_ep_num})(\b|/|\.htm)', rf'\g<1>bolum-{new_ep_num}\g<3>', sample_url, flags=re.I)
    if p1 != sample_url:
        return p1
    # Pattern 2: .../1-sezon/2-bolum -> .../1-sezon/1-bolum
    p2 = re.sub(rf'([-_/])({old_ep_num})[-_]bolum(\b|/|\.htm)', rf'\g<1>{new_ep_num}-bolum\g<3>', sample_url, flags=re.I)
    if p2 != sample_url:
        return p2
    # Pattern 3: general bolum-N anywhere
    p3 = re.sub(rf'bolum[-_]{old_ep_num}\b', f'bolum-{new_ep_num}', sample_url, flags=re.I)
    if p3 != sample_url:
        return p3
    return None

def check_and_extract_gap(gap_item):
    """Worker function to check and extract sources for a missing episode."""
    did, s_num, m_num, cand_url, title = gap_item
    try:
        r = requests.get(cand_url, headers=HEADERS, verify=False, timeout=5)
        if r.status_code == 200 and len(r.text) >= 500:
            sources, is_ph = extract_sources_for_episode(cand_url)
            if sources:
                return (did, s_num, m_num, cand_url, title, sources, is_ph)
    except Exception:
        pass
    return None

def run_concurrent_backfill(max_workers: int = 12):
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()

    print("[GAP_BACKFILL] Scanning archive for sequence gaps...", flush=True)

    cur.execute("""
        SELECT e.drama_id, e.season_number, e.episode_number, e.episode_url, d.title, d.slug
        FROM episodes e
        JOIN dramas d ON d.id = e.drama_id
        WHERE d.content_type NOT IN ('film', 'movie')
          AND e.episode_url IS NOT NULL
        ORDER BY e.drama_id, e.season_number, e.episode_number
    """)
    rows = cur.fetchall()

    drama_data = defaultdict(lambda: defaultdict(list))
    drama_info = {}
    for did, s_num, e_num, ep_url, title, slug in rows:
        drama_data[did][s_num].append((e_num, ep_url))
        drama_info[did] = (title, slug)

    work_items = []
    for did, seasons in drama_data.items():
        for s_num, eps in seasons.items():
            ep_dict = {e[0]: e[1] for e in eps if e[1]}
            sorted_nums = sorted(ep_dict.keys())
            if not sorted_nums or len(sorted_nums) < 2:
                continue
            max_num = max(sorted_nums)
            missing = set(range(1, max_num + 1)) - set(sorted_nums)
            if missing and len(missing) <= 15:
                sample_ep_num = sorted_nums[0]
                sample_url = ep_dict[sample_ep_num]
                title = drama_info[did][0]
                for m_num in sorted(missing):
                    cand_url = interpolate_missing_url(sample_url, sample_ep_num, m_num)
                    if cand_url:
                        work_items.append((did, s_num, m_num, cand_url, title))

    print(f"[GAP_BACKFILL] Prepared {len(work_items)} candidate gap episodes to probe across {max_workers} threads.", flush=True)

    total_recovered_eps = 0
    total_recovered_srcs = 0
    touched_dramas = set()
    lock = threading.Lock()

    start_time = time.time()
    completed = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(check_and_extract_gap, item): item for item in work_items}
        for future in as_completed(futures):
            try:
                res = future.result()
            except Exception:
                res = None
            completed += 1
            if completed % 25 == 0 or res:
                elapsed = time.time() - start_time
                rate = completed / max(elapsed, 1)
                print(f"[{completed}/{len(work_items)}] Probing at {rate:.1f} eps/sec. Recovered: {total_recovered_eps} eps, {total_recovered_srcs} srcs.", flush=True)

            if res:
                did, s_num, m_num, cand_url, title, sources, is_ph = res
                with lock:
                    try:
                        # Check if already inserted
                        cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?", (did, s_num, m_num))
                        row = cur.fetchone()
                        if not row:
                            cur.execute("""
                                INSERT OR IGNORE INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, source_status, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                            """, (did, s_num, m_num, f"{m_num}. Bölüm", cand_url, 'pending' if is_ph else None))
                            new_ep_id = cur.lastrowid
                        else:
                            new_ep_id = row[0]

                        for s_name, embed_id, prov, site, direct_url in sources:
                            cur.execute("""
                                INSERT OR IGNORE INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                            """, (new_ep_id, s_name, embed_id, direct_url or embed_id, prov, site))

                        conn.commit()
                        total_recovered_eps += 1
                        total_recovered_srcs += len(sources)
                        touched_dramas.add(did)
                        print(f"  [+] Drama #{did} ('{title}') S{s_num}E{m_num} added with {len(sources)} sources!", flush=True)
                    except Exception as db_err:
                        print(f"  [!] Drama #{did} S{s_num}E{m_num} db insert warning: {db_err}", flush=True)

    print(f"\n[GAP_BACKFILL] Syncing {len(touched_dramas)} touched dramas to Cloudflare R2 and Supabase...", flush=True)
    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()

    print(f"\n[GAP_BACKFILL COMPLETED] Recovered {total_recovered_eps} gap episodes, {total_recovered_srcs} sources in {time.time()-start_time:.1f}s!", flush=True)
    if total_recovered_eps > 0:
        backup_db_to_r2()

if __name__ == '__main__':
    run_concurrent_backfill(max_workers=14)
